const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');

function findMismatch(text) {
  let stack = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '{' || text[i] === '(') {
      stack.push({ char: text[i], pos: i });
    } else if (text[i] === '}' || text[i] === ')') {
      if (stack.length === 0) {
        return { error: 'extra closing', char: text[i], pos: i };
      }
      let top = stack.pop();
      if ((text[i] === '}' && top.char !== '{') || (text[i] === ')' && top.char !== '(')) {
        return { error: 'mismatch', expected: top.char === '{' ? '}' : ')', found: text[i], pos: i, openPos: top.pos };
      }
    }
  }
  if (stack.length > 0) {
    return { error: 'unclosed', char: stack[stack.length - 1].char, pos: stack[stack.length - 1].pos };
  }
  return { ok: true };
}

// I should strip strings and comments first to be accurate.
// But a simpler approach is trying to use Acorn or just TypeScript's own compiler output
console.log("Checking!");
