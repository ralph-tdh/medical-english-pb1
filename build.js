#!/usr/bin/env node
/* build.js — bundle index.html + engine.js + a lesson JSON into one standalone file.
   Usage: node build.js <lesson.json> [out.html]
   The standalone build runs from file:// and inside webviews (no fetch needed). */
const fs = require('fs');
const path = require('path');

const lessonPath = process.argv[2];
if (!lessonPath) { console.error('Usage: node build.js <lesson.json> [out.html]'); process.exit(1); }

const lessonRaw = fs.readFileSync(lessonPath, 'utf8');
const lesson = JSON.parse(lessonRaw);            // validate it parses
const engine = fs.readFileSync(path.join(__dirname, 'engine.js'), 'utf8');
let html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// Replace the <body> loader section with inlined lesson + engine.
const bodyStart = html.indexOf('<div id="app"></div>');
const head = html.slice(0, bodyStart);

const safeJson = JSON.stringify(lesson)           // single-line, safe to embed
  .replace(/<\/script>/g, '<\\/script>');

const inlined =
  '<div id="app"></div>\n'
  + '<script id="lesson-data" type="application/json">' + safeJson + '</script>\n'
  + '<script>window.LESSON = JSON.parse(document.getElementById("lesson-data").textContent);</script>\n'
  + '<script>\n' + engine + '\n</script>\n</body>\n</html>\n';

const out = head + inlined;
const outPath = process.argv[3] || (lesson.meta.id + '.standalone.html');
fs.writeFileSync(outPath, out);
console.log('Built standalone:', outPath, '(' + out.length + ' bytes)');
