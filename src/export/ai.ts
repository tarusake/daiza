// Adobe Illustrator (.ai) エクスポート（純粋ロジック、React / DOM 非依存）。
//
// .ai の実体は Illustrator 9 以降 **PDF 互換コンテナ**（PDF に Illustrator 固有の
// private data を付したもの）である。private data はクローズド仕様だが、PDF として
// 妥当なファイルであれば Illustrator は .ai として開き、パスも画像も編集できる。
// そこで「PDF を生成して .ai 拡張子で保存する」方式を採る。
//
// pdf-lib は dynamic import する：PDF 生成はエクスポートを押した時にしか要らない
// 一方でライブラリは小さくないため、初期バンドル（＝ページを開いた瞬間の読み込み）に
// 載せない。Vite が自動で別チャンクへ切り出す。
//
// 図形の座標（mm）は export/geometry に集約済みで、SVG エクスポートと完全に同一の
// 幾何を共有する。本モジュールの責務は「mm → PDF ユーザー空間(pt)」の写像と、
// Illustrator でレイヤーとして見える形（OCG）への組み立てだけ。

import type { PDFName as PDFNameObject } from 'pdf-lib';

import { buildExportGeometry, exportColors, strokeWidthMm } from '@/export/geometry';
import type { ExportGeometry, RectMm } from '@/export/geometry';
import type { AnalysisResult, Point } from '@/model/types';
import { closedCurvePathData, curvePathData, mapCurve } from '@/utils/curve';

/** PDF のユーザー空間は 1pt = 1/72 inch。mm 実寸をそのまま pt へ写す係数。 */
const MM_TO_PT = 72 / 25.4;

/** 埋め込む絵柄画像。α を保った PNG のバイト列（生成は DOM 依存なので export/raster が担う）。 */
export interface EmbeddedPng {
  bytes: Uint8Array;
}

/** generateAi の切り替え。 */
export interface AiExportOptions {
  /** 絵柄パーツと台座パーツの間隔(mm)。 */
  partGapMm?: number;
  /** 図形全体の外側に枠を付けるか。 */
  includeFrame?: boolean;
  /** 枠を付ける場合の図形から枠までの余白(mm)。 */
  framePaddingMm?: number;
  /** 面付けページへ原寸で配置するか。 */
  imposeA4?: boolean;
  /** 面付けページ幅(mm)。 */
  impositionPageWidthMm?: number;
  /** 面付けページ高さ(mm)。 */
  impositionPageHeightMm?: number;
  /** カットラインだけを赤で出すか。 */
  redCutLinesOnly?: boolean;
  /** 書き出し幾何全体を左右反転するか。 */
  mirrorX?: boolean;
}

interface PdfExportMode {
  includeArtwork: boolean;
  includeCutLines: boolean;
  title: string;
}

/**
 * Illustrator のレイヤー（＝PDF の OCG）定義。Illustrator は PDF を開くとき
 * Optional Content Group をレイヤーへ対応付けるため、加工用のカットラインと
 * 絵柄を別レイヤーに分け、片方だけ表示／ロックできるようにする。
 */
const LAYERS = [
  { key: 'artwork', name: '絵柄' },
  { key: 'base', name: '差込口・台座' },
  { key: 'cutline', name: 'カットライン' },
] as const;

type LayerKey = (typeof LAYERS)[number]['key'];

/** #rrggbb を pdf-lib の rgb()（各成分 0〜1）へ。配色は SVG と共有する。 */
function hexToRgbComponents(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 0xff) / 255, ((value >> 8) & 0xff) / 255, (value & 0xff) / 255];
}

/**
 * mm 座標（画像左上原点・下向き +Y）を、viewBox 左上を原点とする pt 座標へ写す。
 *
 * pdf-lib の drawSvgPath は「SVG 流儀（Y 下向き）の d を、指定アンカーに置いて
 * scale(1,-1) で描く」実装なので、アンカーをページ左上に取れば、この写像で作った
 * 点列をそのまま渡すだけで PDF 上の正しい位置に出る。曲線補完（closedCurvePathData）も
 * SVG とそのまま共用できる。
 */
function toPt(point: Point, viewBox: RectMm): Point {
  return { x: (point.x - viewBox.x) * MM_TO_PT, y: (point.y - viewBox.y) * MM_TO_PT };
}

/** 矩形版の toPt。 */
function rectToPt(rect: RectMm, viewBox: RectMm): RectMm {
  const origin = toPt({ x: rect.x, y: rect.y }, viewBox);
  return {
    x: origin.x,
    y: origin.y,
    width: rect.width * MM_TO_PT,
    height: rect.height * MM_TO_PT,
  };
}

/** pt 座標の d 文字列は小数 2 桁で十分（1pt ≒ 0.35mm、2 桁で 3.5μm 相当）。 */
function fmtPt(value: number): string {
  return Number(value.toFixed(2)).toString();
}

/**
 * 解析結果と絵柄 PNG から、Illustrator で開ける PDF（=.ai）のバイト列を生成する。
 *
 * 出力はページ 1 枚。ページサイズは viewBox（余白込みの外接矩形）の実寸そのままなので、
 * Illustrator 上でもアートボードが mm 実寸になる。
 */
export async function generateAi(
  result: AnalysisResult,
  png: EmbeddedPng,
  options: AiExportOptions = {},
): Promise<Uint8Array> {
  return generatePdfBytes(result, png, options, {
    includeArtwork: true,
    includeCutLines: true,
    title: 'Daiza 台座設計図（実寸 mm）',
  });
}

/** カットラインだけの Illustrator 互換 PDF（=.ai）を生成する。 */
export async function generateCutlineAi(
  result: AnalysisResult,
  options: AiExportOptions = {},
): Promise<Uint8Array> {
  return generatePdfBytes(result, null, options, {
    includeArtwork: false,
    includeCutLines: true,
    title: 'Daiza カットライン（実寸 mm）',
  });
}

/** 絵柄画像だけの PDF を生成する。 */
export async function generateImagePdf(
  result: AnalysisResult,
  png: EmbeddedPng,
  options: AiExportOptions = {},
): Promise<Uint8Array> {
  return generatePdfBytes(result, png, options, {
    includeArtwork: true,
    includeCutLines: false,
    title: 'Daiza 絵柄画像（実寸 mm）',
  });
}

async function generatePdfBytes(
  result: AnalysisResult,
  png: EmbeddedPng | null,
  options: AiExportOptions,
  mode: PdfExportMode,
): Promise<Uint8Array> {
  const { PDFDocument, PDFHexString, PDFName, PDFOperator, PDFOperatorNames, degrees, rgb } =
    await import('pdf-lib');

  const geometry: ExportGeometry = buildExportGeometry(result, {
    includeImage: mode.includeArtwork,
    ...(options.partGapMm !== undefined ? { partGapMm: options.partGapMm } : {}),
    ...(options.includeFrame !== undefined ? { includeFrame: options.includeFrame } : {}),
    ...(options.framePaddingMm !== undefined ? { framePaddingMm: options.framePaddingMm } : {}),
    ...(options.imposeA4 !== undefined ? { imposeA4: options.imposeA4 } : {}),
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

  const pageWidth = viewBox.width * MM_TO_PT;
  const pageHeight = viewBox.height * MM_TO_PT;

  const doc = await PDFDocument.create();
  doc.setTitle(mode.title);
  const page = doc.addPage([pageWidth, pageHeight]);

  // レイヤー（OCG）を作り、ページのリソースから名前で参照できるようにする。
  // Resources() はページに何か描くまで生えないことがあるため normalize() で確定させる。
  page.node.normalize();
  const resources = page.node.Resources();
  const layerNames = new Map<LayerKey, PDFNameObject>();
  const layerRefs = LAYERS.map((layer, index) => {
    // レイヤー名は日本語なので、Latin-1 しか表せない PDF 文字列ではなく
    // UTF-16BE（BOM 付き）で書ける 16 進文字列にする。
    const ref = doc.context.register(
      doc.context.obj({ Type: 'OCG', Name: PDFHexString.fromText(layer.name) }),
    );
    layerNames.set(layer.key, PDFName.of(`OC${index}`));
    return ref;
  });

  const properties = doc.context.obj({});
  LAYERS.forEach((layer, index) => {
    const ref = layerRefs[index];
    const name = layerNames.get(layer.key);
    if (ref && name) {
      properties.set(name, ref);
    }
  });
  resources?.set(PDFName.of('Properties'), properties);

  // /OCProperties が無いと閲覧側はレイヤーを認識しない。Order がレイヤーパネルの並び。
  doc.catalog.set(
    PDFName.of('OCProperties'),
    doc.context.obj({
      OCGs: layerRefs,
      D: { Order: layerRefs, ON: layerRefs },
    }),
  );

  /** 描画を BDC /OC … EMC で括り、そのレイヤーに属するコンテンツとして印づける。 */
  const inLayer = (key: LayerKey, draw: () => void): void => {
    const name = layerNames.get(key);
    if (!name) {
      draw();
      return;
    }
    page.pushOperators(
      PDFOperator.of(PDFOperatorNames.BeginMarkedContentSequence, [PDFName.of('OC'), name]),
    );
    draw();
    page.pushOperators(PDFOperator.of(PDFOperatorNames.EndMarkedContent));
  };

  // 線幅は SVG と同じ基準（図の対角の 0.3%、下限 0.2mm）で mm から pt へ。
  const borderWidth = strokeWidthMm(viewBox) * MM_TO_PT;
  /** 線のみ（塗りなし）のパスを、ページ左上アンカー・Y 下向きで描く。 */
  const strokePath = (pathData: string, hex: string): void => {
    const [r, g, b] = hexToRgbComponents(hex);
    page.drawSvgPath(pathData, {
      x: 0,
      y: pageHeight,
      borderColor: rgb(r, g, b),
      borderWidth,
    });
  };
  const tilePoint = (offset: Point, point: Point): Point => {
    if (geometry.tileRotationDeg === 0) {
      return { x: point.x + offset.x, y: point.y + offset.y };
    }

    const bounds = geometry.tileBounds;
    return {
      x: bounds.x + offset.x + bounds.height - (point.y - bounds.y),
      y: bounds.y + offset.y + (point.x - bounds.x),
    };
  };
  const rectPathForTile = (offset: Point, rect: RectMm): string => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const corners = [
      { x: rect.x, y: rect.y },
      { x: right, y: rect.y },
      { x: right, y: bottom },
      { x: rect.x, y: bottom },
    ].map((p) => toPt(tilePoint(offset, p), viewBox));
    const [p0, p1, p2, p3] = corners as [Point, Point, Point, Point];
    return (
      `M ${fmtPt(p0.x)} ${fmtPt(p0.y)} ` +
      `L ${fmtPt(p1.x)} ${fmtPt(p1.y)} ` +
      `L ${fmtPt(p2.x)} ${fmtPt(p2.y)} ` +
      `L ${fmtPt(p3.x)} ${fmtPt(p3.y)} Z`
    );
  };
  const rectBoundsForTile = (offset: Point, rect: RectMm): RectMm => {
    const right = rect.x + rect.width;
    const bottom = rect.y + rect.height;
    const corners = [
      { x: rect.x, y: rect.y },
      { x: right, y: rect.y },
      { x: right, y: bottom },
      { x: rect.x, y: bottom },
    ].map((p) => tilePoint(offset, p));
    const xs = corners.map((p) => p.x);
    const ys = corners.map((p) => p.y);
    const minX = Math.min(...xs);
    const minY = Math.min(...ys);
    const maxX = Math.max(...xs);
    const maxY = Math.max(...ys);
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  };

  // 絵柄（最背面）。drawImage は PDF 座標（左下原点・Y 上向き）なので、mm の上端 Y を
  // ページ高さから引いて「画像の下辺」の位置へ直す。
  if (mode.includeArtwork && png !== null) {
    const embedded = await doc.embedPng(png.bytes);
    inLayer('artwork', () => {
      for (const offset of geometry.tileOffsets) {
        const imageBounds = rectBoundsForTile(offset, geometry.image);
        const imageRect = rectToPt(imageBounds, viewBox);
        if (geometry.tileRotationDeg === 90) {
          page.drawImage(embedded, {
            x: imageRect.x,
            y: pageHeight - imageRect.y,
            width: geometry.image.width * MM_TO_PT,
            height: geometry.image.height * MM_TO_PT,
            rotate: degrees(-90),
          });
        } else {
          page.drawImage(embedded, {
            x: imageRect.x,
            y: pageHeight - (imageRect.y + imageRect.height),
            width: imageRect.width,
            height: imageRect.height,
          });
        }
      }
    });
  }

  // 差込口・台座。差込部の首部・ツメは位置確認と加工形状のため独立線としても出す。
  if (mode.includeCutLines) {
    inLayer('base', () => {
      for (const offset of geometry.tileOffsets) {
        // 台座は footprint の曲線パス（SVG と同一の幾何）。矩形以外もベジェのまま出す。
        const basePath = mapCurve(geometry.base.curve, (p) => toPt(tilePoint(offset, p), viewBox));
        strokePath(curvePathData(basePath, fmtPt), colors.base);
        if (!redCutLinesOnly) {
          strokePath(rectPathForTile(offset, geometry.neck), colors.slot);
          strokePath(rectPathForTile(offset, geometry.tab), colors.slot);
        }
        strokePath(rectPathForTile(offset, geometry.baseSlot), colors.baseSlot);
        if (geometry.frame !== undefined) {
          strokePath(rectPathForTile(offset, geometry.frame), colors.frame);
        }
      }
    });

    // カットライン（最前面）。曲線補完した点列をそのままベジェパスとして出すので、
    // Illustrator 上でもアンカー付きのパスとして編集できる。差込部の肩（首部とツメの接合部）
    // だけは丸めず直角のまま出す。除外点も contour と同じ写像を通すことで座標一致を保つ。
    inLayer('cutline', () => {
      for (const offset of geometry.tileOffsets) {
        const contourPt = geometry.contour.map((p) => toPt(tilePoint(offset, p), viewBox));
        const sharpPt = geometry.sharpCorners.map((p) => toPt(tilePoint(offset, p), viewBox));
        strokePath(
          closedCurvePathData(contourPt, fmtPt, { sharpCorners: sharpPt }),
          colors.contour,
        );
      }
    });
  }

  return doc.save();
}
