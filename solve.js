// solve.js: a faster drop-in for csv-reader 1.0.0's readCsv, same answers {columns, rows, errors}.
// Reads with charCodeAt and slices whole runs instead of building fields a character at a time.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;
  let wantHeader = header;

  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  for (;;) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const recordRow = wantHeader ? null : rows.length;
    const fields = [];
    let ended = COMMA;
    let quoted = false;

    while (ended === COMMA) {
      let prefix = null; // text carried into the unquoted reader (a closed quoted value, or '"')
      let junk = false;
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        const open = pos;
        let p = pos + 1;
        let s = p;
        let v = '';
        let nl = 0;
        let closed = false;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c === 34) {
            if (text.charCodeAt(p + 1) === 34) {
              v += text.slice(s, p + 1);
              p += 2;
              s = p;
              continue;
            }
            closed = true;
            break;
          }
          if (c === 13) {
            v += text.slice(s, p) + '\n';
            nl++;
            p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
            s = p;
            continue;
          }
          if (c === 10) nl++;
          p++;
        }
        if (closed) {
          v += text.slice(s, p);
          line += nl;
          pos = p + 1;
          if (pos >= n) {
            fields.push(v);
            ended = END;
            continue;
          }
          const c = text.charCodeAt(pos);
          if (c === 44) {
            pos++;
            fields.push(v);
            continue;
          }
          if (c === 10) {
            pos++;
            line++;
            fields.push(v);
            ended = LINE_BREAK;
            continue;
          }
          if (c === 13 && text.charCodeAt(pos + 1) === 10) {
            pos += 2;
            line++;
            fields.push(v);
            ended = LINE_BREAK;
            continue;
          }
          prefix = v;
          junk = true;
        } else {
          pos = open + 1;
          errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
          prefix = '"';
        }
      }

      // Unquoted characters up to the next comma or line break; a CR not followed by LF is dropped (stray_cr).
      let start = pos;
      let acc = prefix;
      for (;;) {
        if (pos >= n) {
          ended = END;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c === 44) {
          ended = COMMA;
          break;
        }
        if (c === 10) {
          ended = LINE_BREAK;
          break;
        }
        if (c === 13) {
          if (text.charCodeAt(pos + 1) === 10) {
            ended = LINE_BREAK;
            break;
          }
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          acc = acc === null ? text.slice(start, pos) : acc + text.slice(start, pos);
          pos++;
          start = pos;
          continue;
        }
        pos++;
      }
      const value = acc === null ? text.slice(start, pos) : acc + text.slice(start, pos);
      if (ended === COMMA) pos++;
      else if (ended === LINE_BREAK) {
        pos += text.charCodeAt(pos) === 13 ? 2 : 1;
        line++;
      }
      if (junk && value.length > prefix.length) {
        errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
      }
      fields.push(value);
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && !quoted && fields[0] === '') continue;

    if (width < 0) width = fields.length;
    if (wantHeader) {
      columns = fields;
      wantHeader = false;
      continue;
    }
    const k = fields.length;
    if (k < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: k });
      while (fields.length < width) fields.push('');
    } else if (k > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}

// runJSON(input): the same answer as run(input), as its JSON text (JSON.parse(runJSON(x)) deep-equals run(x)).
// main.ts writes this text straight out, so no row arrays are built and no JSON.stringify walks them.
//
// Each record is first read on a fast path that emits JSON pieces into one array (joined once at the end):
//   - a run of consecutive plain unquoted fields (no ", \, control character or surrogate) is one slice of the
//     text with each comma turned into "," (one native replaceAll), wrapped in quotes;
//   - a closed quoted field followed by a comma or line break is its own slice: as it stands when nothing inside
//     needs JSON escaping (the text's quotes are already the JSON quotes), else unescaped ("" -> ", CR/CRLF -> LF)
//     and encoded with JSON.stringify.
// Any record that is broken (stray CR, junk after a quote, an unterminated quote, a width other than the first
// record's) or that is the first record or the header is read again on the slow path, field by field, exactly as
// csv-reader does, with its errors. The fast path never records an error.
export function runJSON(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const parts = [];
  let errs = '';
  let columnsOut = null;
  let width = -1;
  let wantHeader = header;
  let rowCount = 0;

  let pos = n > 0 && text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let line = 1;

  for (;;) {
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recStart = pos;
    const recordLine = line;
    const mark = parts.length;
    let slow = wantHeader || width < 0;

    if (!slow) {
      parts.push(rowCount === 0 ? '[' : ',[');
      let k = 0;
      let items = 0; // JSON items pushed for this row (a run counts once)
      let runStart = -1; // start of the current run of plain unquoted fields
      let runEnd = -1;
      let ended = COMMA;
      fast: while (ended === COMMA) {
        if (text.charCodeAt(pos) === 34) {
          // quoted field
          const open = pos;
          let p = pos + 1;
          let dq = false;
          let cr = false;
          let other = false;
          let nl = 0;
          let closed = false;
          while (p < n) {
            const c = text.charCodeAt(p);
            if (c < 35) {
              if (c === 34) {
                if (text.charCodeAt(p + 1) === 34) {
                  dq = true;
                  p += 2;
                  continue;
                }
                closed = true;
                break;
              }
              if (c === 10) nl++;
              else if (c === 13) {
                cr = true;
                if (text.charCodeAt(p + 1) !== 10) nl++;
              } else if (c < 32) other = true;
            } else if (c === 92 || (c & 0xf800) === 0xd800) other = true;
            p++;
          }
          if (!closed) {
            slow = true;
            break fast;
          }
          const close = p;
          p++;
          if (p >= n) ended = END;
          else {
            const c = text.charCodeAt(p);
            if (c === 44) {
              p++;
            } else if (c === 10) {
              p++;
              nl++;
              ended = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(p + 1) === 10) {
              p += 2;
              nl++;
              ended = LINE_BREAK;
            } else {
              slow = true;
              break fast;
            }
          }
          if (runStart >= 0) {
            const seg = text.slice(runStart, runEnd);
            parts.push(items > 0 ? ',"' : '"', seg.indexOf(',') >= 0 ? seg.replaceAll(',', '","') : seg, '"');
            items++;
            runStart = -1;
          }
          if (items > 0) parts.push(',');
          items++;
          if (!dq && !cr && nl === 0 && !other) {
            parts.push(text.slice(open, close + 1));
          } else {
            let v = text.slice(open + 1, close);
            if (dq) v = v.replaceAll('""', '"');
            if (cr) v = v.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
            parts.push(JSON.stringify(v));
          }
          line += nl;
          pos = p;
          k++;
        } else {
          // unquoted field: extends the current run
          const s = pos;
          let p = pos;
          for (;;) {
            if (p >= n) {
              ended = END;
              break;
            }
            const c = text.charCodeAt(p);
            if (c < 45) {
              if (c === 44) break;
              if (c === 10) {
                ended = LINE_BREAK;
                break;
              }
              if (c === 13) {
                if (text.charCodeAt(p + 1) === 10) {
                  ended = LINE_BREAK;
                  break;
                }
                slow = true;
                break fast;
              }
              if (c === 34 || c < 32) {
                slow = true;
                break fast;
              }
            } else if (c === 92 || (c & 0xf800) === 0xd800) {
              slow = true;
              break fast;
            }
            p++;
          }
          if (runStart < 0) runStart = s;
          runEnd = p;
          if (ended === COMMA) pos = p + 1;
          else if (ended === LINE_BREAK) {
            pos = p + (text.charCodeAt(p) === 13 ? 2 : 1);
            line++;
          } else pos = p;
          k++;
        }
      }
      if (!slow) {
        if (k !== width) slow = true;
        else {
          if (runStart >= 0) {
            const seg = text.slice(runStart, runEnd);
            const body = seg.indexOf(',') >= 0 ? seg.replaceAll(',', '","') : seg;
            parts.push(items > 0 ? ',"' : '"', body, '"]');
          } else parts.push(']');
          rowCount++;
        }
      }
    }

    if (!slow) continue;

    // Slow path: this record, field by field, as csv-reader reads it.
    pos = recStart;
    line = recordLine;
    parts.length = mark;
    const rowTxt = wantHeader ? 'null' : '' + rowCount;
    let rec = '';
    let k = 0;
    let cutAt = -1;
    let ended = COMMA;
    let quoted = false;
    let onlyEmpty = false;

    while (ended === COMMA) {
      let prefix = null;
      let junk = false;
      let esc = false;
      quoted = text.charCodeAt(pos) === 34;
      if (quoted) {
        const open = pos;
        let p = pos + 1;
        let s = p;
        let v = '';
        let nl = 0;
        let closed = false;
        while (p < n) {
          const c = text.charCodeAt(p);
          if (c < 35) {
            if (c === 34) {
              if (text.charCodeAt(p + 1) === 34) {
                v += text.slice(s, p + 1);
                p += 2;
                s = p;
                esc = true;
                continue;
              }
              closed = true;
              break;
            }
            if (c === 13) {
              v += text.slice(s, p) + '\n';
              nl++;
              p += text.charCodeAt(p + 1) === 10 ? 2 : 1;
              s = p;
              esc = true;
              continue;
            }
            if (c === 10) nl++;
            if (c < 32) esc = true;
          } else if (c === 92 || (c & 0xf800) === 0xd800) esc = true;
          p++;
        }
        if (closed) {
          v += text.slice(s, p);
          line += nl;
          pos = p + 1;
          let fin = -1;
          if (pos >= n) fin = END;
          else {
            const c = text.charCodeAt(pos);
            if (c === 44) {
              pos++;
              fin = COMMA;
            } else if (c === 10) {
              pos++;
              line++;
              fin = LINE_BREAK;
            } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
              pos += 2;
              line++;
              fin = LINE_BREAK;
            }
          }
          if (fin >= 0) {
            ended = fin;
            const e = esc ? JSON.stringify(v) : '"' + v + '"';
            rec = k === 0 ? e : rec + ',' + e;
            k++;
            if (k === width) cutAt = rec.length;
            continue;
          }
          prefix = v;
          junk = true;
        } else {
          pos = open + 1;
          errs += ',{"code":"unterminated_quote","line":' + recordLine + ',"row":' + rowTxt + '}';
          prefix = '"';
          esc = true;
        }
      }

      let start = pos;
      let acc = prefix;
      for (;;) {
        if (pos >= n) {
          ended = END;
          break;
        }
        const c = text.charCodeAt(pos);
        if (c < 45) {
          if (c === 44) {
            ended = COMMA;
            break;
          }
          if (c === 10) {
            ended = LINE_BREAK;
            break;
          }
          if (c === 13) {
            if (text.charCodeAt(pos + 1) === 10) {
              ended = LINE_BREAK;
              break;
            }
            errs += ',{"code":"stray_cr","line":' + recordLine + ',"row":' + rowTxt + '}';
            acc = acc === null ? text.slice(start, pos) : acc + text.slice(start, pos);
            pos++;
            start = pos;
            continue;
          }
          if (c === 34 || c < 32) esc = true;
        } else if (c === 92 || (c & 0xf800) === 0xd800) esc = true;
        pos++;
      }
      const value = acc === null ? text.slice(start, pos) : acc + text.slice(start, pos);
      if (ended === COMMA) pos++;
      else if (ended === LINE_BREAK) {
        pos += text.charCodeAt(pos) === 13 ? 2 : 1;
        line++;
      }
      if (junk && value.length > prefix.length) {
        errs += ',{"code":"quote_junk","line":' + recordLine + ',"row":' + rowTxt + '}';
      }
      onlyEmpty = value.length === 0;
      const e = esc ? JSON.stringify(value) : '"' + value + '"';
      rec = k === 0 ? e : rec + ',' + e;
      k++;
      if (k === width) cutAt = rec.length;
    }

    // A line that held only stray CRs: no record.
    if (k === 1 && !quoted && onlyEmpty) continue;

    if (width < 0) {
      width = k;
      cutAt = rec.length;
    }
    if (wantHeader) {
      columnsOut = '[' + rec + ']';
      wantHeader = false;
      continue;
    }
    if (k < width) {
      errs += ',{"code":"short_row","line":' + recordLine + ',"row":' + rowTxt + ',"fields":' + k + '}';
      rec += ',""'.repeat(width - k);
    } else if (k > width) {
      errs += ',{"code":"long_row","line":' + recordLine + ',"row":' + rowTxt + ',"extra":[' + rec.slice(cutAt + 1) + ']}';
      rec = rec.slice(0, cutAt);
    }
    parts.push(rowCount === 0 ? '[' : ',[', rec, ']');
    rowCount++;
  }
  const cols = header ? (columnsOut ?? '[]') : 'null';
  return '{"columns":' + cols + ',"rows":[' + parts.join('') + '],"errors":[' + errs.slice(1) + ']}';
}

// runBytes(input): the same answer as run(input), as the UTF-8 bytes of its JSON text
// (JSON.parse(Buffer.from(runBytes(x)).toString()) deep-equals run(x)).
//
// The text is encoded to UTF-8 once (one native call) and read a byte at a time: every field is copied byte by byte
// straight into the output buffer, JSON-escaped as it goes (" \ and control characters; "" in quotes is one ", each
// CR, CRLF or LF in quotes one \n), so no string is made per field and nothing is converted again on the way out.
// UTF-8 bytes of non-ASCII characters are all 0x80 or more and so are never mistaken for a comma, quote or line
// break. A text holding a lone surrogate (which UTF-8 cannot carry) is answered by runJSON instead.
export function runBytes(input, capHint) {
  const text = String(input.text);
  if (!text.isWellFormed()) return Buffer.from(runJSON(input), 'utf8');
  const header = input.header === true;
  const src = Buffer.from(text, 'utf8');
  const n = src.length;

  let cap = capHint > 0 ? capHint : n * 2 + 65536;
  let out = Buffer.allocUnsafe(cap);
  let lim = cap - 64;
  let o = 0;

  // errors: a string of JSON objects, each led by a comma (rare: a few per hundred records)
  let errs = '';

  const HEX = '0123456789abcdef';
  const PRE = header ? '{"columns":' : '{"columns":null,"rows":[';
  for (let i = 0; i < PRE.length; i++) out[o++] = PRE.charCodeAt(i);

  let pos = n >= 3 && src[0] === 0xef && src[1] === 0xbb && src[2] === 0xbf ? 3 : 0;
  let line = 1;
  let width = -1;
  let wantHeader = header;
  let rowCount = 0;

  for (;;) {
    while (pos < n) {
      const c = src[pos];
      if (c === 10) {
        pos++;
        line++;
      } else if (c === 13 && src[pos + 1] === 10) {
        pos += 2;
        line++;
      } else break;
    }
    if (pos >= n) break;

    const recordLine = line;
    const isHeader = wantHeader;
    const rowTxt = isHeader ? 'null' : '' + rowCount;
    const recOut = o;
    if (!isHeader && rowCount > 0) out[o++] = 44;
    out[o++] = 91;
    let k = 0;
    let cutOut = -1;
    let ended = COMMA;
    let quoted = false;
    let lastEmpty = false;

    while (ended === COMMA) {
      if (k > 0) out[o++] = 44;
      const fieldOut = o;
      out[o++] = 34;
      quoted = src[pos] === 34;
      let junk = false;
      let junkFrom = 0;
      if (quoted) {
        const open = pos;
        let p = pos + 1;
        let nl = 0;
        let closed = false;
        while (p < n) {
          if (o >= lim) {
            const nb = Buffer.allocUnsafe((cap *= 2));
            out.copy(nb, 0, 0, o);
            out = nb;
            lim = cap - 64;
          }
          const c = src[p];
          if (c < 93) {
            if (c === 34) {
              if (src[p + 1] === 34) {
                out[o++] = 92;
                out[o++] = 34;
                p += 2;
                continue;
              }
              closed = true;
              break;
            }
            if (c === 13) {
              out[o++] = 92;
              out[o++] = 110;
              nl++;
              p += src[p + 1] === 10 ? 2 : 1;
              continue;
            }
            if (c === 10) {
              out[o++] = 92;
              out[o++] = 110;
              nl++;
              p++;
              continue;
            }
            if (c === 92) {
              out[o++] = 92;
              out[o++] = 92;
              p++;
              continue;
            }
            if (c < 32) {
              out[o++] = 92;
              out[o++] = 117;
              out[o++] = 48;
              out[o++] = 48;
              out[o++] = HEX.charCodeAt(c >> 4);
              out[o++] = HEX.charCodeAt(c & 15);
              p++;
              continue;
            }
          }
          out[o++] = c;
          p++;
        }
        if (closed) {
          line += nl;
          pos = p + 1;
          let fin = -1;
          if (pos >= n) fin = END;
          else {
            const c = src[pos];
            if (c === 44) {
              pos++;
              fin = COMMA;
            } else if (c === 10) {
              pos++;
              line++;
              fin = LINE_BREAK;
            } else if (c === 13 && src[pos + 1] === 10) {
              pos += 2;
              line++;
              fin = LINE_BREAK;
            }
          }
          if (fin >= 0) {
            ended = fin;
            out[o++] = 34;
            k++;
            if (k === width) cutOut = o;
            continue;
          }
          junk = true;
          junkFrom = o;
        } else {
          // The quote never closes: a literal character, and the text after it is read again as unquoted.
          o = fieldOut + 1;
          pos = open + 1;
          errs += ',' + '{"code":"unterminated_quote","line":' + recordLine + ',"row":' + rowTxt + '}';
          out[o++] = 92;
          out[o++] = 34;
        }
      }

      // Unquoted bytes up to the next comma or line break; a CR not followed by LF is dropped (stray_cr).
      for (;;) {
        if (pos >= n) {
          ended = END;
          break;
        }
        if (o >= lim) {
          const nb = Buffer.allocUnsafe((cap *= 2));
          out.copy(nb, 0, 0, o);
          out = nb;
          lim = cap - 64;
        }
        const c = src[pos];
        if (c < 93) {
          if (c === 44) {
            ended = COMMA;
            pos++;
            break;
          }
          if (c === 10) {
            ended = LINE_BREAK;
            pos++;
            line++;
            break;
          }
          if (c === 13) {
            if (src[pos + 1] === 10) {
              ended = LINE_BREAK;
              pos += 2;
              line++;
              break;
            }
            errs += ',' + '{"code":"stray_cr","line":' + recordLine + ',"row":' + rowTxt + '}';
            pos++;
            continue;
          }
          if (c === 34) {
            out[o++] = 92;
            out[o++] = 34;
            pos++;
            continue;
          }
          if (c === 92) {
            out[o++] = 92;
            out[o++] = 92;
            pos++;
            continue;
          }
          if (c < 32) {
            out[o++] = 92;
            out[o++] = 117;
            out[o++] = 48;
            out[o++] = 48;
            out[o++] = HEX.charCodeAt(c >> 4);
            out[o++] = HEX.charCodeAt(c & 15);
            pos++;
            continue;
          }
        }
        out[o++] = c;
        pos++;
      }
      if (junk && o > junkFrom) errs += ',' + '{"code":"quote_junk","line":' + recordLine + ',"row":' + rowTxt + '}';
      lastEmpty = o === fieldOut + 1;
      out[o++] = 34;
      k++;
      if (k === width) cutOut = o;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (k === 1 && !quoted && lastEmpty) {
      o = recOut;
      continue;
    }

    if (width < 0) {
      width = k;
      cutOut = o;
    }
    if (isHeader) {
      out[o++] = 93;
      const s = ',"rows":[';
      for (let i = 0; i < s.length; i++) out[o++] = s.charCodeAt(i);
      wantHeader = false;
      continue;
    }
    if (k < width) {
      errs += ',' + '{"code":"short_row","line":' + recordLine + ',"row":' + rowTxt + ',"fields":' + k + '}';
      for (let i = k; i < width; i++) {
        if (o >= lim) {
          const nb = Buffer.allocUnsafe((cap *= 2));
          out.copy(nb, 0, 0, o);
          out = nb;
          lim = cap - 64;
        }
        out[o++] = 44;
        out[o++] = 34;
        out[o++] = 34;
      }
    } else if (k > width) {
      errs += ',{"code":"long_row","line":' + recordLine + ',"row":' + rowTxt + ',"extra":[' + out.toString('utf8', cutOut + 1, o) + ']}';
      o = cutOut;
    }
    out[o++] = 93;
    rowCount++;
  }

  const tail = (wantHeader ? '[],"rows":[' : '') + '],"errors":[' + errs.slice(1) + ']}';
  const need = o + tail.length * 3 + 8;
  if (need > cap) {
    const nb = Buffer.allocUnsafe(need);
    out.copy(nb, 0, 0, o);
    out = nb;
  }
  o += out.write(tail, o, 'utf8');
  return out.subarray(0, o);
}

// Warm-up: read small synthetic files that walk every branch (header or not, quotes with "" and line breaks, CRLF,
// stray CR, junk after a quote, short and long rows, blank lines, escapes, control characters, an unterminated quote,
// a growing output buffer) so V8 has type feedback for the rare branches before the first real case and does not throw
// away its optimized code when one is first met. Drawn from a fixed LCG; it touches no case data and keeps nothing.
{
  const tok = ['ab', 'cd ef', '', '"q"', '"x ""y"", z"', '"l\nm"', '"c\r\nd"', '"e\rf"', '\\', 'é', '\ud83d\ude00',
    'u\rv', '"j"kg', '"j"\r', 'a"b', '\t', '"\\"', '"a\u0001b"', 'c\u0002d', '"j"x\ry', '12.5', '東京', '"Москва"',
    '\r', '"m""', '"""', '""'];
  let seed = 7;
  const r = (m) => ((seed = (seed * 1103515245 + 12345) >>> 0) % m);
  for (let f = 0; f < 8; f++) {
    const eol = f & 1 ? '\r\n' : '\n';
    let w = f & 2 ? '\uFEFF' : '';
    if (f & 4) w += eol + '\r' + eol;
    for (let i = 0; i < 400; i++) {
      const x = r(30);
      if (x === 0) w += eol;
      else if (x === 1) w += '\r' + eol;
      else if (x === 4) w += '\n\n';
      const width = x === 2 ? 2 : x === 3 ? 5 : x === 5 ? 1 : 3;
      for (let j = 0; j < width; j++) w += (j ? ',' : '') + (r(3) ? tok[r(4)] : tok[r(tok.length)]);
      w += eol;
    }
    const ends = ['"open,' + tok[0] + eol + 'z,y', 'a,b,"c"', 'a,b,c' + eol, 'a,"b\r', 'x,y,"z"' + eol + eol, 'p,q,'];
    w += ends[f % ends.length];
    for (const h of [true, false]) {
      runJSON({ text: w, header: h });
      runBytes({ text: w, header: h });
      runBytes({ text: w, header: h }, 64);
      run({ text: w, header: h });
    }
  }
  runBytes({ text: '', header: true });
  runBytes({ text: 'a\ud800', header: false });
}
