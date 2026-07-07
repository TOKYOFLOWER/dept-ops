// GAS実行環境の最小スタブを用意し、実際の gas/*.js を vm 上でロードして
// 抽出した純粋関数をNode上でユニットテストするためのヘルパー。
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GAS_DIR = path.resolve(__dirname, '../gas');

function base64url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(String(input), 'utf8');
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// GASのXmlService.Elementの最小サブセット（getChild/getChildren/getChildText/getText）を
// jsdomのDOMParserが返すXML DOMの上にラップして再現する。
function wrapXmlElement(domEl) {
  if (!domEl) return null;
  return {
    getChild(name) {
      for (const child of Array.from(domEl.children)) {
        if (child.tagName === name) return wrapXmlElement(child);
      }
      return null;
    },
    getChildren(name) {
      return Array.from(domEl.children)
        .filter((child) => !name || child.tagName === name)
        .map(wrapXmlElement);
    },
    getChildText(name) {
      const child = this.getChild(name);
      return child ? child.getText() : null;
    },
    getText() { return domEl.textContent; },
    getName() { return domEl.tagName; },
  };
}

export function buildSandbox(scriptPropsOverrides) {
  const scriptProps = Object.assign({}, scriptPropsOverrides || {});
  const logs = [];
  const sheetsData = {}; // name -> array of row arrays (assigned by tests as needed)

  const sandbox = {
    console,
    Utilities: {
      base64Encode(s) { return Buffer.from(String(s), 'utf8').toString('base64'); },
      base64EncodeWebSafe(s) { return base64url(s); },
      computeHmacSha256Signature(payload, secret) {
        const digest = crypto.createHmac('sha256', secret).update(String(payload), 'utf8').digest();
        return Array.from(digest); // 0-255の配列（GASのsigned byteでも (b&0xff) で同じ結果になる）
      },
      computeRsaSha256Signature(payload, pem) {
        const signer = crypto.createSign('RSA-SHA256');
        signer.update(String(payload));
        signer.end();
        return signer.sign(pem);
      },
      formatDate(date, tz, fmt) {
        // テストでは呼ばれない想定の簡易フォールバック
        return date.toISOString().slice(0, 10);
      },
    },
    PropertiesService: {
      getScriptProperties() {
        return {
          getProperty(key) { return Object.prototype.hasOwnProperty.call(scriptProps, key) ? scriptProps[key] : null; },
        };
      },
    },
    SpreadsheetApp: {
      getActiveSpreadsheet() {
        return {
          getSheetByName(name) {
            if (!(name in sheetsData)) return null;
            return {
              getDataRange() {
                return { getValues() { return sheetsData[name]; } };
              },
              appendRow(row) { sheetsData[name].push(row); },
              getLastRow() { return sheetsData[name].length; },
              getRange(r, c) {
                return {
                  setValue(v) { sheetsData[name][r - 1][c - 1] = v; },
                };
              },
              setFrozenRows() {},
            };
          },
          insertSheet(name) { sheetsData[name] = []; return this.getSheetByName(name); },
        };
      },
    },
    CacheService: {
      getScriptCache() {
        const store = {};
        return {
          get(k) { return store[k] || null; },
          put(k, v) { store[k] = v; },
        };
      },
    },
    UrlFetchApp: {
      fetch() { throw new Error('UrlFetchApp.fetch は本テストでは未スタブ（呼ばれない想定）'); },
    },
    ContentService: {
      MimeType: { JSON: 'JSON' },
      createTextOutput(text) {
        return { _text: text, setMimeType() { return this; } };
      },
    },
    HtmlService: {
      createHtmlOutput(html) {
        return { _html: html, setTitle() { return this; } };
      },
    },
    ScriptApp: { getOAuthToken() { return 'fake-oauth-token'; } },
    XmlService: {
      parse(xmlText) {
        const dom = new JSDOM();
        const doc = new dom.window.DOMParser().parseFromString(xmlText, 'application/xml');
        const parserError = doc.getElementsByTagName('parsererror')[0];
        if (parserError) throw new Error('XmlService.parse: XML解析エラー: ' + parserError.textContent);
        const root = doc.documentElement;
        return { getRootElement() { return wrapXmlElement(root); } };
      },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return { sandbox, sheetsData, logs };
}

export function loadGasFiles(sandbox, files) {
  for (const f of files) {
    const code = fs.readFileSync(path.join(GAS_DIR, f), 'utf8');
    vm.runInContext(code, sandbox, { filename: f });
  }
}

export { GAS_DIR };
