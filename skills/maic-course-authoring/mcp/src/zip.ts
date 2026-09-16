/**
 * SPDX-License-Identifier: MIT
 * Copyright (c) 2026 maic-course-gen-skills contributors
 */

/**
 * 最小 ZIP 读写实现。
 *
 * 只依赖 `node:zlib` 与 `node:buffer`，不引入 `jszip`——这样 bundle 出来的
 * 单文件在离线环境也能打包，而"能打包"是整条链路的地基。
 *
 * 写入：本地文件头 + 数据 + 中央目录 + EOCD，UTF-8 文件名标志（0x0800）已置位，
 * 中文路径安全。文本走 deflate，已是压缩格式的媒体直接 store。
 * 读取：扫 EOCD → 中央目录 → 需要时解出单个条目（供 `--check` 使用）。
 *
 * 产物的兼容性由冒烟测试用系统 `unzip` 反向验证。
 */

import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { extname } from 'node:path';

import { AUDIO_EXTENSIONS, MEDIA_EXTENSIONS } from './contract.js';

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const FLAG_UTF8 = 0x0800;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = -1;
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function dosDateTime(date = new Date()): { time: number; day: number } {
  const year = Math.max(1980, date.getFullYear());
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, day };
}

/** 已是压缩格式的媒体直接 store，省 CPU 也避免无意义膨胀。 */
function shouldStore(name: string): boolean {
  const ext = extname(name).slice(1).toLowerCase();
  return MEDIA_EXTENSIONS.has(ext) || AUDIO_EXTENSIONS.has(ext) || ext === 'zip';
}

export interface ZipEntryInput {
  name: string;
  data: Buffer;
}

export interface ZipEntryInfo {
  name: string;
  method: number;
  compSize: number;
  uncompSize: number;
  localOffset: number;
}

export function buildZip(entries: readonly ZipEntryInput[]): Buffer {
  const { time, day } = dosDateTime();
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const data = entry.data;
    const crc = crc32(data);
    const store = shouldStore(entry.name);
    const body = store ? data : deflateRawSync(data, { level: 9 });
    const method = store ? METHOD_STORE : METHOD_DEFLATE;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(FLAG_UTF8, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(day, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, nameBuf, body);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(FLAG_UTF8, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt16LE(time, 12);
    central.writeUInt16LE(day, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    // external attrs：目录位清零，普通文件
    central.writeUInt32LE(store ? 0 : 0x81a40000, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, nameBuf);

    offset += local.length + nameBuf.length + body.length;
  }

  const localPart = Buffer.concat(locals);
  const centralPart = Buffer.concat(centrals);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

export function listZipEntries(buf: Buffer): ZipEntryInfo[] {
  let eocd = -1;
  const lowerBound = Math.max(0, buf.length - 22 - 65535);
  for (let i = buf.length - 22; i >= lowerBound; i -= 1) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('不是有效的 ZIP：未找到 EOCD');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries: ZipEntryInfo[] = [];

  for (let i = 0; i < count; i += 1) {
    if (buf.readUInt32LE(p) !== SIG_CENTRAL) throw new Error('ZIP 中央目录损坏');
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const uncompSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

export function readZipEntry(buf: Buffer, entry: ZipEntryInfo): Buffer {
  const p = entry.localOffset;
  if (buf.readUInt32LE(p) !== SIG_LOCAL) throw new Error('ZIP 局部头损坏');
  const nameLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const start = p + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  return entry.method === METHOD_STORE ? Buffer.from(raw) : inflateRawSync(raw);
}

/** ZIP 路径安全：不以 `/` 开头、不含 `..`。 */
export function isSafeZipPath(path: string): boolean {
  if (typeof path !== 'string' || path.length === 0) return false;
  if (path.startsWith('/') || path.startsWith('\\')) return false;
  if (path.includes('\\')) return false;
  return !path.split('/').includes('..');
}
