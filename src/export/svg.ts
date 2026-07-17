// SVG エクスポート（純粋ロジック、React / DOM 非依存）。
//
// AnalysisResult を実寸(mm)座標系の SVG 文字列へ変換する。SPEC のエクスポート指定
// どおり「外形・差込口・台座」の 3 要素を描き、支持範囲・重心・鉛直線などの
// プレビュー専用オーバーレイは含めない。絵柄画像は任意で最背面へ重ねられる（下記）。
// ダウンロード（Blob 生成・a要素クリック）は DOM 依存の副作用のため本モジュールには
// 置かず、呼び出し側（App）に委ねる。こうして生成ロジックを純粋に保つことで、
// テスト容易性と将来の WebAssembly 置き換えに備える。
//
// 図形の座標（mm）は export/geometry へ集約し、.ai エクスポートと同一の幾何を共有する。
// SVG の user unit を mm と 1:1 に対応させる（width/height に "mm" を付し、viewBox の
// 数値をそのまま mm とみなす）ため、印刷・CAD 取り込み時に実寸となる。

import {
  buildExportGeometry,
  exportColors,
  fmt,
  type ExportGeometry,
  type RectMm,
  strokeWidthMm,
} from '@/export/geometry';
import type { AnalysisResult, Point } from '@/model/types';
import { closedCurvePathData, curvePathData, mapCurve } from '@/utils/curve';

/** generateSvg の切り替え。 */
export interface SvgExportOptions {
  /**
   * 絵柄画像の data URL。指定したときだけ画像を最背面へ埋め込む。
   * 画素データの取得は DOM（canvas）依存なので、本モジュールは data URL を受け取るに
   * とどめ、生成は呼び出し側（export/raster）に任せる。
   */
  imageHref?: string;
  /** 絵柄パーツと台座パーツの間隔(mm)。 */
  partGapMm?: number;
  /** 図形全体の外側に枠を付けるか。 */
  includeFrame?: boolean;
  /** 枠を付ける場合の図形から枠までの余白(mm)。 */
  framePaddingMm?: number;
  /** 面付けページへ原寸で配置するか。 */
  imposeA4?: boolean;
  impositionGapMm?: number;
  /** 面付けページ幅(mm)。 */
  impositionPageWidthMm?: number;
  /** 面付けページ高さ(mm)。 */
  impositionPageHeightMm?: number;
  /** カットラインだけを赤で出すか。 */
  redCutLinesOnly?: boolean;
  /** 書き出し幾何全体を左右反転するか。 */
  mirrorX?: boolean;
}

function tilePoint(geometry: ExportGeometry, offset: Point, point: Point): Point {
  if (geometry.tileRotationDeg === 0) {
    return { x: point.x + offset.x, y: point.y + offset.y };
  }

  const bounds = geometry.tileBounds;
  return {
    x: bounds.x + offset.x + bounds.height - (point.y - bounds.y),
    y: bounds.y + offset.y + (point.x - bounds.x),
  };
}

function rectPathForTile(geometry: ExportGeometry, offset: Point, rect: RectMm): string {
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const corners = [
    { x: rect.x, y: rect.y },
    { x: right, y: rect.y },
    { x: right, y: bottom },
    { x: rect.x, y: bottom },
  ].map((p) => tilePoint(geometry, offset, p));
  const [p0, p1, p2, p3] = corners as [Point, Point, Point, Point];
  return (
    `M ${fmt(p0.x)} ${fmt(p0.y)} ` +
    `L ${fmt(p1.x)} ${fmt(p1.y)} ` +
    `L ${fmt(p2.x)} ${fmt(p2.y)} ` +
    `L ${fmt(p3.x)} ${fmt(p3.y)} Z`
  );
}

function pathElement(pathData: string, attrs: string): string {
  return `<path d="${pathData}" ${attrs} />`;
}

/** 絵柄画像を実寸で置く image 要素。カットラインと同じ mm 座標系にそのまま乗る。 */
function imageElement(geometry: ExportGeometry, href: string, offset: Point): string {
  const { image } = geometry;
  const transform =
    geometry.tileRotationDeg === 0
      ? `translate(${fmt(offset.x)} ${fmt(offset.y)})`
      : imageRotationMatrix(geometry, offset);
  return (
    `<image href="${href}" x="${fmt(image.x)}" y="${fmt(image.y)}" ` +
    `width="${fmt(image.width)}" height="${fmt(image.height)}" preserveAspectRatio="none" ` +
    `transform="${transform}" />`
  );
}

function imageRotationMatrix(geometry: ExportGeometry, offset: Point): string {
  const bounds = geometry.tileBounds;
  const a = 0;
  const b = 1;
  const c = -1;
  const d = 0;
  const e = bounds.x + offset.x + bounds.height + bounds.y;
  const f = bounds.y + offset.y - bounds.x;
  return `matrix(${fmt(a)} ${fmt(b)} ${fmt(c)} ${fmt(d)} ${fmt(e)} ${fmt(f)})`;
}

/**
 * 解析結果から実寸(mm)座標系の SVG ドキュメント文字列を生成する。
 *
 * 塗りは持たせず輪郭線のみとし、外形・差込口・台座を色分けする。options.imageHref を
 * 渡した場合のみ絵柄画像を最背面に敷き、線データが絵柄の上に載った状態で出力する。
 */
export function generateSvg(result: AnalysisResult, options: SvgExportOptions = {}): string {
  const { imageHref } = options;
  const geometry = buildExportGeometry(result, {
    includeImage: imageHref !== undefined,
    ...(options.partGapMm !== undefined ? { partGapMm: options.partGapMm } : {}),
    ...(options.includeFrame !== undefined ? { includeFrame: options.includeFrame } : {}),
    ...(options.framePaddingMm !== undefined ? { framePaddingMm: options.framePaddingMm } : {}),
    ...(options.imposeA4 !== undefined ? { imposeA4: options.imposeA4 } : {}),
    ...(options.impositionGapMm !== undefined ? { impositionGapMm: options.impositionGapMm } : {}),
    ...(options.impositionPageWidthMm !== undefined
      ? { impositionPageWidthMm: options.impositionPageWidthMm }
      : {}),
    ...(options.impositionPageHeightMm !== undefined
      ? { impositionPageHeightMm: options.impositionPageHeightMm }
      : {}),
    ...(options.mirrorX !== undefined ? { mirrorX: options.mirrorX } : {}),
  });
  const { viewBox } = geometry;
  const redCutLinesOnly = options.redCutLinesOnly === true;
  const colors = exportColors(redCutLinesOnly);

  const strokeAttr = `stroke-width="${fmt(strokeWidthMm(viewBox))}"`;
  const viewBoxAttr = `${fmt(viewBox.x)} ${fmt(viewBox.y)} ${fmt(viewBox.width)} ${fmt(viewBox.height)}`;

  // 画像は線データに隠されないよう最背面（先頭）へ。fill/stroke の既定は g に持たせるが、
  // image はそれらの影響を受けないのでグループ内に置いて差し支えない。
  const elements = geometry.tileOffsets.flatMap((offset) => {
    // 外形（カットライン）は折れ線ではなく曲線補完した path（C コマンド）で出力する（SPEC 要件）。
    // 差込部の肩（首部とツメの接合部）だけは丸めず直角のまま出す（加工寸法に直結するため）。
    const contour = geometry.contour.map((p) => tilePoint(geometry, offset, p));
    const sharpCorners = geometry.sharpCorners.map((p) => tilePoint(geometry, offset, p));
    const contourEl = pathElement(
      closedCurvePathData(contour, fmt, { sharpCorners }),
      `fill="none" stroke="${colors.contour}" ${strokeAttr}`,
    );
    const slotElements = redCutLinesOnly
      ? []
      : [
          pathElement(
            rectPathForTile(geometry, offset, geometry.neck),
            `fill="none" stroke="${colors.slot}" ${strokeAttr}`,
          ),
          pathElement(
            rectPathForTile(geometry, offset, geometry.tab),
            `fill="none" stroke="${colors.slot}" ${strokeAttr}`,
          ),
        ];
    // 台座は「台座形状」で選んだ footprint の上面図。矩形以外も曲線コマンドで出力する。
    const baseCurve = mapCurve(geometry.base.curve, (p) => tilePoint(geometry, offset, p));
    const baseEl = pathElement(
      curvePathData(baseCurve, fmt),
      `fill="none" stroke="${colors.base}" ${strokeAttr}`,
    );
    const baseSlotEl = pathElement(
      rectPathForTile(geometry, offset, geometry.baseSlot),
      `fill="none" stroke="${colors.baseSlot}" ${strokeAttr}`,
    );
    const frameEl =
      geometry.frame !== undefined
        ? pathElement(
            rectPathForTile(geometry, offset, geometry.frame),
            `fill="none" stroke="${colors.frame}" ${strokeAttr}`,
          )
        : undefined;

    return [
      ...(imageHref !== undefined ? [imageElement(geometry, imageHref, offset)] : []),
      contourEl,
      ...slotElements,
      baseEl,
      baseSlotEl,
      ...(frameEl !== undefined ? [frameEl] : []),
    ];
  });

  // width/height に "mm" を付け、viewBox の数値を mm と 1:1 対応させて実寸出力とする。
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
      `width="${fmt(viewBox.width)}mm" height="${fmt(viewBox.height)}mm" ` +
      `viewBox="${viewBoxAttr}">`,
    '  <title>Daiza 台座設計図（実寸 mm）</title>',
    `  <g fill="none" stroke-linejoin="round">`,
    ...elements.map((el) => `    ${el}`),
    '  </g>',
    '</svg>',
    '',
  ].join('\n');
}
