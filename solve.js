// A faster drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input)
// returns exactly what csv-reader's readCsv returns for the same {text, header},
// as {columns, rows, errors}, following its broken-row policy byte for byte.
//
// The reference walks the text one character at a time and builds every field
// a character at a time. This reader works in bulk instead, in two layers:
//
//   1. Whole-record fast path. A record whose text (up to its first line feed,
//      minus a trailing CR when the break is CRLF) holds no double quote and
//      no CR is split in one C++ call: String.split(','). That is sound: a
//      line feed inside a quoted field can only follow the field's opening
//      quote, so a record with no quote in it cannot hide one, and with no CR
//      in it there is no stray CR and no CRLF to mistake. Most records of the
//      drawn sets take this path.
//   2. Field parser for the rest. Each unquoted field's end is found with
//      indexOf (comma / line feed, both C++ scans) and the field is sliced out
//      in one go; the common case (a fresh unquoted field) is inlined in the
//      record loop instead of going through a call. A quoted field's closing
//      quote is the first quote that is not doubled, its inner text sliced
//      once and normalised in bulk ("" -> ", CR / CRLF -> LF, the line count
//      from the same pass). Only the rare broken paths do per-character work,
//      and only over the one short field involved: a stray CR inside a field,
//      junk after a closing quote, a quote that never closes.
//
// The policy, as the reference states it:
//   - a U+FEFF at the very start of the text is dropped;
//   - a record ends at LF or CRLF, and a line left with no characters is no
//     record; outside a quoted field a CR not followed by LF is dropped
//     (stray_cr); a line that held only stray CRs is no record either (its
//     stray_cr errors stay);
//   - a field that opens with a quote runs to the next quote that is not
//     doubled, "" inside it one quote, and each CRLF or lone CR inside it is
//     read as LF; what follows its closing quote, up to the next comma or
//     line break, is appended to it as it stands (quote_junk, when the field
//     ends); a quote that never closes is read as a literal character and the
//     text after it is read again as an unquoted field (unterminated_quote);
//   - a quote inside an unquoted field is a literal character; fields stay
//     strings, never trimmed or converted;
//   - columns is the first record when header is true, else null; rows holds
//     the records after it (every record when header is false), each padded
//     with "" (short_row, with fields: its count) or cut (long_row, with
//     extra: the cut fields) to the first record's width;
//   - each error is {code, line, row}: line the 1-based line its record
//     starts on (every LF, CRLF and lone CR inside a quoted field counted),
//     row its record's index in rows (null for the header), in the order met,
//     a field's quote_junk when the field ends and a record's short_row or
//     long_row when the record ends.

/** How the last field read ended: 0 at a comma, 1 at a line break, 2 at the end. */
const COMMA = 0;
const BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const n = text.length;
  let pos = text.charCodeAt(0) === 0xfeff ? 1 : 0; // a U+FEFF at the very start is dropped
  let line = 1; // the line the character at pos is on

  // The record being read: the line it starts on and the index in rows it takes.
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters the last unquoted
  // read kept (a junk read's quote_junk fires only when it kept at least one).
  let fEnded = END;
  let fAdded = 0;

  // Drops every CR from `seg` (each is a stray one: the slice holds no line
  // feed), recording a stray_cr error per CR; returns what is kept and sets
  // fAdded to how many characters were kept.
  function stripStrayCr(seg) {
    let kept = '';
    let added = 0;
    for (let i = 0; i < seg.length; i++) {
      const c = seg.charCodeAt(i);
      if (c === 13) errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
      else {
        kept += seg[i];
        added += 1;
      }
    }
    fAdded = added;
    return kept;
  }

  // Reads an unquoted field starting at pos, onto `init`, up to the next comma
  // or line break: a CR not followed by LF is dropped (stray_cr). Returns the
  // field; fEnded says how it ended and fAdded how many characters it kept.
  // The slice handed to the slow path holds no line feed, so every CR in it
  // is a stray one: its next character is never a line feed.
  function readUnquoted(init) {
    let value = init;
    const start = pos;
    const ci = text.indexOf(',', pos);
    const li = text.indexOf('\n', pos);
    if (ci !== -1 && (li === -1 || ci < li)) {
      const seg = text.slice(start, ci);
      if (seg.indexOf('\r') === -1) {
        if (value === '') value = seg;
        else value += seg;
        fAdded = seg.length;
      } else {
        value += stripStrayCr(seg);
      }
      pos = ci + 1;
      fEnded = COMMA;
    } else if (li !== -1) {
      let end = li;
      if (li > start && text.charCodeAt(li - 1) === 13) end = li - 1; // CRLF ends here
      const seg = text.slice(start, end);
      if (seg.indexOf('\r') === -1) {
        if (value === '') value = seg;
        else value += seg;
        fAdded = seg.length;
      } else {
        value += stripStrayCr(seg);
      }
      pos = li + 1;
      line += 1;
      fEnded = BREAK;
    } else {
      const seg = text.slice(start);
      if (seg.indexOf('\r') === -1) {
        if (value === '') value = seg;
        else value += seg;
        fAdded = seg.length;
      } else {
        value += stripStrayCr(seg);
      }
      pos = n;
      fEnded = END;
    }
    return value;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;

    let fields;
    let quoted = false;
    // Whole-record fast path: the record's text up to its first line feed (a
    // trailing CR belongs to a CRLF break) with no quote and no CR in it is
    // just comma-separated fields. A quote or a CR means quoted fields, stray
    // CRs, junk or an unterminated quote may be inside, so fall through to
    // the field parser, which re-derives the record's true end.
    const li = text.indexOf('\n', pos);
    const recEnd = li === -1 ? n : li;
    let segEnd = recEnd;
    if (li !== -1 && recEnd > pos && text.charCodeAt(recEnd - 1) === 13) segEnd = recEnd - 1;
    const seg = text.slice(pos, segEnd);
    if (seg.indexOf('"') === -1 && seg.indexOf('\r') === -1) {
      fields = seg.split(',');
      pos = li === -1 ? n : li + 1;
      if (li !== -1) line += 1;
    } else {
      fields = [];
      do {
        if (text.charCodeAt(pos) === 34) {
          quoted = true;
          // A quoted field: the closing quote is the first quote not doubled.
          const open = pos;
          let q = text.indexOf('"', pos + 1);
          while (q !== -1 && text.charCodeAt(q + 1) === 34) q = text.indexOf('"', q + 2);
          if (q === -1) {
            // The quote never closes: it is a literal character, and the text
            // after it is read again as an unquoted field.
            errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
            pos = open + 1;
            fields.push(readUnquoted('"'));
          } else {
            const inner = text.slice(open + 1, q);
            let value = inner;
            // Each CRLF or lone CR inside the quotes is one LF; count the
            // breaks (each is one line) and normalise them in bulk.
            if (inner.indexOf('\r') !== -1) {
              const breaks = inner.match(/\r\n|\r|\n/g);
              line += breaks === null ? 0 : breaks.length;
              value = inner.replace(/\r\n?/g, '\n');
              if (inner.indexOf('""') !== -1) value = value.replaceAll('""', '"');
            } else {
              if (inner.indexOf('""') !== -1) value = inner.replaceAll('""', '"');
              let idx = inner.indexOf('\n');
              while (idx !== -1) {
                line += 1;
                idx = inner.indexOf('\n', idx + 1);
              }
            }
            pos = q + 1;
            if (pos >= n) {
              fields.push(value);
              fEnded = END;
            } else {
              const c = text.charCodeAt(pos);
              if (c === 44) {
                fields.push(value);
                pos += 1;
                fEnded = COMMA;
              } else if (c === 10) {
                fields.push(value);
                pos += 1;
                line += 1;
                fEnded = BREAK;
              } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
                fields.push(value);
                pos += 2;
                line += 1;
                fEnded = BREAK;
              } else {
                // What follows the closing quote is appended as it stands, up
                // to the next comma or line break.
                const v = readUnquoted(value);
                if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
                fields.push(v);
              }
            }
          }
        } else {
          // Fresh unquoted field: the common case, inlined here (no call)
          // instead of going through readUnquoted.
          quoted = false;
          const start = pos;
          const ci = text.indexOf(',', pos);
          const li = text.indexOf('\n', pos);
          let value;
          if (ci !== -1 && (li === -1 || ci < li)) {
            value = text.slice(start, ci);
            if (value.indexOf('\r') !== -1) value = stripStrayCr(value);
            else fAdded = value.length;
            pos = ci + 1;
            fEnded = COMMA;
          } else if (li !== -1) {
            let end = li;
            if (li > start && text.charCodeAt(li - 1) === 13) end = li - 1; // CRLF ends here
            value = text.slice(start, end);
            if (value.indexOf('\r') !== -1) value = stripStrayCr(value);
            else fAdded = value.length;
            pos = li + 1;
            line += 1;
            fEnded = BREAK;
          } else {
            value = text.slice(start);
            if (value.indexOf('\r') !== -1) value = stripStrayCr(value);
            else fAdded = value.length;
            pos = n;
            fEnded = END;
          }
          fields.push(value);
        }
      } while (fEnded === COMMA);
    }

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
