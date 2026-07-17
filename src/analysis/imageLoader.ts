// 画像読み込み：PNG / SVG の File を受け取り、ブラウザ内で RGBA へデコードして FigureImage を得る。
//
// このモジュールは「入力の受け口」であり、解析パイプライン（重心・差込口…）の
// 前段に位置する純粋ロジック。React には依存しない。
//
// プライバシー要件（SPEC）：画像はブラウザ内でのみ処理し、外部へ送信しない。
// そのため createImageBitmap → Canvas という完全ローカルな経路でデコードする。
//
// 失敗は例外で投げず、型付きの AnalysisError として返す。呼び出し側（UI）が
// クラッシュせずにメッセージ表示へマッピングできるようにするため。

import { depositPixels } from '@/model/pixelStore';
import { computeOutsideArtworkMm, RECOMMENDED_DPI, type ScaleParameters } from '@/analysis/scale';
import type { AnalysisError, AnalysisErrorKind, FigureImage } from '@/model/types';
import { hasVisiblePixels, MIN_ALPHA_THRESHOLD } from '@/utils/image';

/** imageLoader が返し得るエラー種別。 */
type ImageLoadErrorKind = Extract<
  AnalysisErrorKind,
  'imageLoadFailed' | 'unsupportedImage' | 'transparentImage'
>;

/** 画像読み込みの結果。成功なら FigureImage、失敗なら型付きエラー。 */
export type ImageLoadResult =
  { ok: true; image: FigureImage } | { ok: false; error: AnalysisError };

/** エラー結果を組み立てる小ヘルパー。 */
function fail(kind: ImageLoadErrorKind): ImageLoadResult {
  return { ok: false, error: { kind } };
}

/**
 * 読み込みごとに単調増加する画像 id を採番する。
 * FigureImage.id は「どの読み込みか」を一意に指すだけでよく、値の意味は問わない。
 * useAnalysis の解析照合と、pixelStore（解析用ピクセルの React 外の受け渡し）の
 * 鍵として使う。
 */
let nextImageId = 0;

/** 1 inch = 25.4mm。指定したフィギュア高さから350dpiの画素数へ換算する。 */
const MM_PER_INCH = 25.4;

/** SVGのラスタライズ解像度へ影響する実寸条件を比較可能な文字列にする。 */
export function svgScaleKey(parameters: ScaleParameters): string {
  return [
    parameters.figureHeightMm,
    parameters.cutLineMarginMm,
    parameters.plateLiftMm,
    parameters.thicknessMm,
  ].join('/');
}

function looksLikeSvg(file: File): boolean {
  return file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg');
}

/**
 * PNG / SVG ファイルかどうかを緩く判定する。
 * MIME 型が空になる環境（一部の D&D 等）もあるため、拡張子も併せて許容する。
 * 中身の厳密な検証は createImageBitmap のデコード可否に委ねる。
 */
function looksLikeSupportedImage(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type === 'image/png' ||
    file.type === 'image/svg+xml' ||
    name.endsWith('.png') ||
    name.endsWith('.svg')
  );
}

/** SVG の viewBox から縦横比を取得する。width/height の単位には依存しない。 */
function svgAspectRatio(svg: SVGSVGElement): number | null {
  const viewBox = svg
    .getAttribute('viewBox')
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  if (viewBox?.length === 4) {
    const width = viewBox[2];
    const height = viewBox[3];
    if (width && height && width > 0 && height > 0) return width / height;
  }

  const width = Number.parseFloat(svg.getAttribute('width') ?? '');
  const height = Number.parseFloat(svg.getAttribute('height') ?? '');
  return width > 0 && height > 0 ? width / height : null;
}

/**
 * SVG を一度 HTMLImageElement へ読み込み、Canvas から ImageBitmap 化する。
 * createImageBitmap が SVG Blob を直接扱えないブラウザでも動作する互換経路。
 */
async function decodeSvg(file: File, scaleParameters: ScaleParameters): Promise<ImageBitmap> {
  const text = await file.text();
  const documentNode = new DOMParser().parseFromString(text, 'image/svg+xml');
  if (documentNode.getElementsByTagName('parsererror').length > 0) {
    throw new Error('Invalid SVG');
  }
  const svg = documentNode.documentElement as unknown as SVGSVGElement;
  if (svg.localName !== 'svg') throw new Error('Missing SVG root');

  // SVG は画像として扱い、実行可能要素・イベント属性・外部参照を持ち込まない。
  for (const element of Array.from(
    svg.querySelectorAll('script, foreignObject, iframe, object, embed'),
  )) {
    element.remove();
  }
  for (const element of Array.from(svg.querySelectorAll('*'))) {
    for (const attribute of Array.from(element.attributes)) {
      const value = attribute.value.trim();
      if (/^on/i.test(attribute.name)) {
        element.removeAttribute(attribute.name);
      } else if (
        /^(?:href|xlink:href|src)$/i.test(attribute.name) &&
        value !== '' &&
        !value.startsWith('#') &&
        !value.startsWith('data:image/')
      ) {
        element.removeAttribute(attribute.name);
      }
    }
  }

  const aspect = svgAspectRatio(svg);
  if (!aspect || !Number.isFinite(aspect)) throw new Error('SVG has no size');
  // DPIは絵柄そのものの実寸に対する画素密度。フィギュア全高にはカットライン余白・
  // 持ち上げ量・板厚も含まれるため、既存のスケール計算と同じ定義でそれらを差し引く。
  const artworkHeightMm = scaleParameters.figureHeightMm - computeOutsideArtworkMm(scaleParameters);
  if (!(artworkHeightMm > 0)) throw new Error('Figure height is too small');
  const height = Math.max(1, Math.round((artworkHeightMm * RECOMMENDED_DPI) / MM_PER_INCH));
  const width = Math.max(1, Math.round(height * aspect));

  // 明示寸法を与えることで、viewBox だけのSVGもブラウザ差なく同じ解像度で描画できる。
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  const blob = new Blob([new XMLSerializer().serializeToString(documentNode)], {
    type: 'image/svg+xml',
  });
  const url = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas is unavailable');
    context.drawImage(image, 0, 0, width, height);
    return await createImageBitmap(canvas);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * PNG / SVG ファイルを読み込み、描画用 ImageBitmap を持つ FigureImage を返す。
 *
 * 手順：PNG 判定 → createImageBitmap でデコード → Canvas へ描画して
 * getImageData で RGBA ピクセルを取得 → 全透明チェック。
 *
 * RGBA ピクセル（ImageData）は戻り値に含めず pixelStore へ預ける：ImageData を
 * React の state へ載せると dev ビルドの props シリアライズが picture 全画素を列挙して
 * フリーズするため（model/types の FigureImage 注記参照）。解析側（useAnalysis）が
 * 画像 id で一度だけ取り出して Worker へ転送する。
 */
export async function loadImageFile(
  file: File,
  scaleParameters: ScaleParameters,
): Promise<ImageLoadResult> {
  if (!looksLikeSupportedImage(file)) {
    return fail('unsupportedImage');
  }

  const isSvg = looksLikeSvg(file);
  // SVG は互換デコード経路、PNG は createImageBitmap でローカルにデコードする。
  let bitmap: ImageBitmap;
  try {
    bitmap = isSvg ? await decodeSvg(file, scaleParameters) : await createImageBitmap(file);
  } catch {
    return fail('imageLoadFailed');
  }

  const width = bitmap.width;
  const height = bitmap.height;
  if (width === 0 || height === 0) {
    bitmap.close();
    return fail('imageLoadFailed');
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  // willReadFrequently: getImageData を前提とした描画であることを明示し、
  // ブラウザに読み出し向けの内部表現を選ばせて性能低下を避ける。
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    bitmap.close();
    return fail('imageLoadFailed');
  }

  ctx.drawImage(bitmap, 0, 0);

  let imageData: ImageData;
  try {
    imageData = ctx.getImageData(0, 0, width, height);
  } catch {
    // 通常ローカル画像で汚染は起きないが、getImageData の失敗も握り潰さず扱う。
    bitmap.close();
    return fail('imageLoadFailed');
  }

  // 読み込み段階で弾くのは「α が全画素 0」の完全透明 PNG だけ。ユーザーが指定する
  // アルファ閾値（AnalysisParameters.alphaThreshold）はここでは未知であり、しきい値を
  // 上げた結果として不透明領域が消えるケースは解析側（analysis/pipeline）がエラーにする。
  if (!hasVisiblePixels(imageData, MIN_ALPHA_THRESHOLD)) {
    bitmap.close();
    return fail('transparentImage');
  }

  // bitmap はプレビュー描画用として FigureImage が長期保持する（close しない）。
  // 解析用ピクセルは React を経由させず、id を鍵に pixelStore で受け渡す。
  const id = nextImageId++;
  depositPixels(id, imageData);

  return {
    ok: true,
    image: {
      id,
      fileName: file.name,
      bitmap,
      width,
      height,
      ...(isSvg
        ? { svgSourceFile: file, svgScaleKey: svgScaleKey(scaleParameters) }
        : {}),
    },
  };
}
