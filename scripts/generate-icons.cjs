// assets/icon.svg (マスター) と assets/icon-small.svg (32px以下用) から
// icon.png / icon.ico / icon.icns を再生成するワンオフスクリプト。
//
// 依存パッケージは通常インストールしていないため、実行時のみ導入する:
//   npm i --no-save sharp png-to-ico @fiahfy/icns
//   node scripts/generate-icons.cjs
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');
const pngToIco = require('png-to-ico');
const { Icns, IcnsImage } = require('@fiahfy/icns');

const ASSETS = path.join(__dirname, '..', 'assets');
const MASTER_SVG = path.join(ASSETS, 'icon.svg');
const SMALL_SVG = path.join(ASSETS, 'icon-small.svg');

async function renderPng(svgPath, size) {
  return sharp(svgPath, { density: (72 * size) / 128 })
    .resize(size, size)
    .png()
    .toBuffer();
}

async function main() {
  const svgFor = (size) => (size <= 32 ? SMALL_SVG : MASTER_SVG);

  fs.writeFileSync(path.join(ASSETS, 'icon.png'), await renderPng(MASTER_SVG, 512));

  const icoPngs = [];
  for (const size of [16, 24, 32, 48, 64, 128, 256]) {
    icoPngs.push(await renderPng(svgFor(size), size));
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.ico'), await pngToIco(icoPngs));

  const icnsTypes = [
    ['ic11', 32],
    ['ic12', 64],
    ['ic07', 128],
    ['ic13', 256],
    ['ic08', 256],
    ['ic14', 512],
    ['ic09', 512],
    ['ic10', 1024]
  ];
  const icns = new Icns();
  for (const [osType, size] of icnsTypes) {
    icns.append(IcnsImage.fromPNG(await renderPng(svgFor(size), size), osType));
  }
  fs.writeFileSync(path.join(ASSETS, 'icon.icns'), icns.data);

  console.log('Generated assets/icon.png, assets/icon.ico, assets/icon.icns');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
