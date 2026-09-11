'use strict';
const fs = require('node:fs');
const path = require('node:path');
const parser = require('@babel/parser');
const root = path.resolve(__dirname, '../services/billing');
const modules = fs.readdirSync(root).filter(name => name.endsWith('.js')).sort();
function walk(node, visit) {
  if (!node || typeof node !== 'object') return;
  if (typeof node.type === 'string') visit(node);
  Object.values(node).forEach(v => { if (Array.isArray(v)) v.forEach(n => walk(n, visit)); else walk(v, visit); });
}
test.each(modules)('BILLING-011: %s has only confined deterministic dependencies and no IO/clock capabilities', name => {
  const ast = parser.parse(fs.readFileSync(path.join(root, name), 'utf8'), { sourceType: 'script' });
  walk(ast, node => {
    if (node.type === 'CallExpression' && node.callee.name === 'require') {
      expect(node.arguments).toHaveLength(1);
      expect(node.arguments[0].type).toBe('StringLiteral');
      const dependency = node.arguments[0].value;
      expect(dependency === 'node:crypto' && name === 'value.js' ||
        dependency.startsWith('./') && modules.includes(dependency.slice(2) + '.js')).toBe(true);
    }
    if (node.type === 'Identifier') expect(['fetch', 'process', 'global', 'globalThis', 'Date',
      'setTimeout', 'setInterval', 'eval', 'Function', 'XMLHttpRequest'].includes(node.name)).toBe(false);
    if (node.type === 'ImportExpression' || node.type === 'ImportDeclaration') throw new Error('Unreviewed import capability');
    if ('async' in node) expect(node.async).not.toBe(true);
    if (node.type === 'MemberExpression' && node.object.name === 'Math') expect(node.property.name).not.toBe('random');
  });
});
