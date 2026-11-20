#!/usr/bin/env node
/**
 * build-rbxmx.mjs — package the Z.ai bridge plugin as a .rbxmx (Roblox XML
 * model). Studio's "Plugins folder" accepts .rbxm and .rbxmx identically;
 * this generator exists so the artifact can be rebuilt without rojo.
 *
 *   node scripts/build-rbxmx.mjs
 *   → public/zai-bridge-roblox.rbxmx
 */
import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const srcPath = join(root, 'roblox-plugin', 'src', 'ZAIWorkspaceBridge', 'init.server.luau');
const outPath = join(root, 'public', 'zai-bridge-roblox.rbxmx');

const source = readFileSync(srcPath, 'utf8');

if (source.includes(']]>')) {
  throw new Error('plugin source contains "]]>" which would break CDATA — rewrite that line');
}

// XML-escape any remaining sensitive characters outside CDATA needs (none expected)
const name = 'ZAIWorkspaceBridge';

const xml =
  '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">\n' +
  `  <Item class="Script" referent="RBX0">\n` +
  '    <Properties>\n' +
  `      <string name="Name">${name}</string>\n` +
  '      <bool name="Disabled">false</bool>\n' +
  '      <ProtectedString name="Source"><![CDATA[' + source + ']]></ProtectedString>\n' +
  '    </Properties>\n' +
  '  </Item>\n' +
  '</roblox>\n';

writeFileSync(outPath, xml, 'utf8');
console.log(`wrote ${outPath} (${Buffer.byteLength(xml)} bytes, script ${source.length} chars)`);
