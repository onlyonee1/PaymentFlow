'use strict';

const bigintLiteral = /(^|[^\w$])((?:0[xX][\da-fA-F](?:_?[\da-fA-F])*|0[bB][01](?:_?[01])*|0[oO][0-7](?:_?[0-7])*|\d(?:_?\d)*)n)\b/g;

exports.handlers = {
  beforeParse(event) {
    event.source = event.source
      .split(/(?<=\n)/)
      .map((line) => {
        if (/^\s*(?:\/\*|\*|\/\/)/.test(line)) return line;
        return line.replace(bigintLiteral, (_match, prefix, literal) => (
          `${prefix}BigInt("${literal.slice(0, -1).replace(/_/g, '')}")`
        ));
      })
      .join('');
  },
};
