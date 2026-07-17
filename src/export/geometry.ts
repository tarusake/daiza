// エクスポート共通の幾何（純粋ロジック、React / DOM 非依存）。
//
// SVG（export/svg.ts）と Illustrator/.ai（export/ai.ts）は、同じ解析結果を別の
// ファイル形式へ書き出すだけで、**描く図形そのものは同一**である。座標変換や外接矩形の
// 算出を各形式に持たせると、片方だけ直したときに 2 つの成果物がズレる。そこで
// 「解析結果 → mm 座標の図形一式」への変換をこのモジュールへ一元化し、各形式は
// ここで得た幾何を自分の構文へ写すだけにする。
//
// 座標系：解析と同じくピクセル左上原点・下方向 +Y を維持し、mmPerPixel で mm へ換算する。

import { slotJunctionCorners } from '@/analysis/slot';
import type { AnalysisResult, Point } from '@/model/types';
import { mapCurve, type ClosedCurve } from '@/utils/curve';

/** 図形を配置する余白(mm)。外接矩形の外周に取り、線が縁で切れないようにする。 */
const MARGIN_MM = 5;

/**
 * 要素の描き分けに使う色。レーザー加工などで各要素を判別しやすいよう色分けする
 * （プレビューのオーバーレイと同じ配色にして認知負荷を下げる）。
 */
export const EXPORT_COLORS = {
  /** 外形（カットライン）。 */
  contour: '#374151',
  /** 差込部（首部・ツメ）。 */
  slot: '#2563eb',
  /** 台座に切る差込口。 */
  baseSlot: '#2563eb',
  /** 台座。 */
  base: '#16a34a',
  /** 面付け・裁ち落とし確認用の枠。 */
  frame: '#111827',
} as const;

export const RED_CUTLINE_COLORS = {
  ...EXPORT_COLORS,
  contour: '#ff0000',
  baseSlot: '#ff0000',
  base: '#ff0000',
  frame: '#000000',
} as const satisfies Record<keyof typeof EXPORT_COLORS, string>;

export function exportColors(redCutLinesOnly: boolean): Record<keyof typeof EXPORT_COLORS, string> {
  return redCutLinesOnly ? RED_CUTLINE_COLORS : EXPORT_COLORS;
}

/** 面付け用紙サイズの既定値。A4 縦置きの実寸(mm)。 */
export const DEFAULT_IMPOSITION_PAGE_MM = { width: 210, height: 297 } as const;

/**
 * mm 値をファイル出力向けの短い文字列へ整える。
 * 浮動小数の桁あふれ（0.1 + 0.2 = 0.30000…）で出力が肥大するのを防ぐため小数
 * 3 桁で丸め、末尾の余分な 0 を Number 経由で落とす。3 桁 = 1μm 相当で実用十分。
 */
export function fmt(value: number): string {
  return Number(value.toFixed(3)).toString();
}

/** 軸平行な矩形の左上原点・寸法（mm）。 */
export interface RectMm {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PartPlacement {
  x: number;
  y: number;
  rotationDeg: 0 | 90;
}

export interface SeparatePartsLayout {
  figureBounds: RectMm;
  baseBounds: RectMm;
  figurePlacements: readonly PartPlacement[];
  basePlacements: readonly PartPlacement[];
  setCount: number;
}

export function placePartPoint(point: Point, bounds: RectMm, placement: PartPlacement): Point {
  const localX = point.x - bounds.x;
  const localY = point.y - bounds.y;
  return placement.rotationDeg === 0
    ? { x: placement.x + localX, y: placement.y + localY }
    : { x: placement.x + bounds.height - localY, y: placement.y + localX };
}

/**
 * 台座 footprint（上面図の外形）を書き出し座標系(mm)へ写したもの。
 *
 * 曲線パス（curve）は SVG / .ai が同じ幾何を曲線コマンドで出力するために持つ（矩形以外の
 * footprint も折れ線に落とさない。SPEC「台座のスリット」）。折れ線（outline）は viewBox の
 * 外接算出に使う。
 */
export interface BaseFootprintMm {
  /** 曲線パス（直線＋3 次ベジェ）。 */
  curve: ClosedCurve;
  /** 曲線を平坦化した頂点列。 */
  outline: readonly Point[];
  /** バウンディングボックス（上辺 = 台座上面）。 */
  bounds: RectMm;
}

/**
 * 書き出す図形一式を mm 座標で束ねた中間表現。
 * 外接矩形（viewBox）の算出と各形式への文字列化の双方がこれを入力にすることで、
 * 座標変換を 1 箇所（buildExportGeometry）へ集約し、要素追加時の座標系ずれを防ぐ。
 */
export interface ExportGeometry {
  /** 外形（アクリル板本体＋首部＋ツメを一体化したカットライン）の頂点列（mm）。 */
  contour: readonly Point[];
  /**
   * 外形のうち曲線補完で丸めない頂点（差込部の肩＝首部とツメの接合部、mm）。
   * contour と同じ mm 換算を通しているため、頂点列に現れる座標と厳密に一致する。
   */
  sharpCorners: readonly Point[];
  /** 差込部の首部（mm）。baseFigure のみ。 */
  neck?: RectMm;
  /** 差込部のツメ（mm）。baseFigure のみ。 */
  tab?: RectMm;
  /** 台座（台座上面へ bbox 上辺を合わせて置く実寸の footprint、mm）。baseFigure のみ。 */
  base?: BaseFootprintMm;
  /**
   * 台座に切るスリット（差込口）の footprint（mm）。baseFigure のみ。
   */
  baseSlot?: RectMm;
  /** キーホルダー穴（mm）。keychain のみ。 */
  hole?: { center: Point; radius: number };
  /** 絵柄画像を実寸で置く矩形（mm）。画像は解析と同じ左上原点なので常に原点始まり。 */
  image: RectMm;
  /** 任意で追加する枠線（mm）。 */
  frame?: RectMm;
  /** 1 タイル分の外接。面付けではこの寸法を基準に行列数を決める。 */
  tileBounds: RectMm;
  /** 面付け時に採用したタイル回転。数が多く入る 0度 / 90度を自動選択する。 */
  tileRotationDeg: 0 | 90;
  /** 面付け時の複製オフセット。通常出力では [{ x: 0, y: 0 }] の 1 要素。 */
  tileOffsets: readonly Point[];
  /** 絵柄・台座を独立面付けする場合の配置。 */
  separatePartsLayout?: SeparatePartsLayout;
  /** 全要素を包む外接矩形に余白を足した領域（mm）。 */
  viewBox: RectMm;
}

type ExportGeometryBody = Omit<
  ExportGeometry,
  'tileBounds' | 'tileRotationDeg' | 'tileOffsets' | 'viewBox'
>;

/** buildExportGeometry の切り替え。 */
export interface ExportGeometryOptions {
  /**
   * 絵柄画像を成果物に含めるか。含める場合のみ viewBox が画像矩形を包む。
   * 画像とカットラインは互いにはみ出し得る（カットラインは余白ぶん外側へ膨らみ、
   * 一方で画像は透明余白を持ち得る）ため、含める時だけ外接に加える。
   */
  includeImage: boolean;
  /** 絵柄パーツと台座パーツの間隔(mm)。0 なら組み立て位置のまま重ねて出す。 */
  partGapMm?: number;
  /** 図形全体の外側に枠を付けるか。 */
  includeFrame?: boolean;
  /** 枠を付ける場合の図形から枠までの余白(mm)。 */
  framePaddingMm?: number;
  /** 面付けページへ原寸で配置するか。 */
  imposeA4?: boolean;
  /** 面付け時、絵柄と台座を独立配置して同数セットを最大化する。 */
  separatePartsImposition?: boolean;
  /** パーツ間の隙間、および面付け外周からの余白(mm)。 */
  impositionGapMm?: number;
  /** 面付けページ幅(mm)。未指定なら A4 幅。 */
  impositionPageWidthMm?: number;
  /** 面付けページ高さ(mm)。未指定なら A4 高さ。 */
  impositionPageHeightMm?: number;
  /** 書き出し幾何全体を左右反転するか。 */
  mirrorX?: boolean;
}

/**
 * 解析結果を mm 座標の描画幾何へ変換する。
 *
 * 外形・差込部はプレビュー（render/overlay）と同じ前面図として mm 換算する。
 * 台座は前面図に現れない奥行を持つため、「台座形状」で選んだ footprint の**上面図**を、
 * バウンディングボックスの上辺を**台座上面**（base.topYMm＝カットライン最下端＋持ち上げ量）に
 * 合わせて下方向へ描く。これにより幅・奥行の両方を実寸のまま 1 枚の図へ載せつつ、板本体が
 * 台座と重ならないこと・ツメ（深さ=板厚 ≦ 奥行）が台座を貫通しないことが出力形状の上でも
 * 保証される。矩形以外の footprint も曲線パスのまま写すので、SVG と .ai は同一の幾何を共有する。
 *
 * この台座 footprint は上面図（真上から見た平面）なので、その**縦方向が奥行軸**になる。
 * 上辺（台座上面 Y）を台座の後縁、下辺を前縁とみなす（真上から見て手前が下＝前）。
 * 差込口の前後オフセット（正=前）は下方向のずれとして写り、スリットは
 * 「奥行中心 + 前後オフセット」を中心に板厚ぶんの幅で切られる。
 */
export function buildExportGeometry(
  result: AnalysisResult,
  options: ExportGeometryOptions,
): ExportGeometry {
  const { mmPerPixel, imageSize, contour } = result;

  const toMm = (p: Point): Point => ({ x: p.x * mmPerPixel, y: p.y * mmPerPixel });
  const contourMm = contour.map(toMm);

  // 絵柄画像：解析と同じ画素座標系にそのまま乗るので、原点から実寸サイズぶん。
  const imageRect: RectMm = {
    x: 0,
    y: 0,
    width: imageSize.width * mmPerPixel,
    height: imageSize.height * mmPerPixel,
  };

  // keychain モード：回転済み contour + 穴のみ。
  if (result.keychain) {
    const { keychain } = result;
    const hole = {
      center: toMm(keychain.holeCenterPixel),
      radius: keychain.holeRadiusMm,
    };
    const bounds = [holeRect(hole), ...(options.includeImage ? [imageRect] : [])];
    const viewBox = computeViewBox(contourMm, bounds);
    return {
      contour: contourMm,
      sharpCorners: [],
      hole,
      image: imageRect,
      tileBounds: viewBox,
      tileRotationDeg: 0,
      tileOffsets: [{ x: 0, y: 0 }],
      viewBox,
    };
  }

  // baseFigure モード：既存の首・ツメ・台座・スリットを含める。
  const { slot, base } = result;
  if (!slot || !base) {
    throw new Error('buildExportGeometry requires slot/base for baseFigure mode');
  }

  const baseTopYMm = base.topYMm;

  const neckTopYMm = slot.neck.yPixel * mmPerPixel;
  const neckRect: RectMm = {
    x: slot.centerXMm - slot.neckWidthMm / 2,
    y: neckTopYMm,
    width: slot.neckWidthMm,
    height: Math.max(0, baseTopYMm - neckTopYMm),
  };

  const tabRect: RectMm = {
    x: slot.centerXMm - slot.widthMm / 2,
    y: baseTopYMm,
    width: slot.widthMm,
    height: slot.tabDepthMm,
  };

  const baseOriginYMm = baseTopYMm + base.depthMm / 2;
  const toBaseMm = (p: Point): Point => ({
    x: slot.centerXMm + p.x,
    y: baseOriginYMm + p.y,
  });
  let baseFootprint: BaseFootprintMm = {
    curve: mapCurve(base.footprint.curve, toBaseMm),
    outline: base.footprint.polyline.map(toBaseMm),
    bounds: {
      x: slot.centerXMm - base.widthMm / 2,
      y: baseTopYMm,
      width: base.widthMm,
      height: base.depthMm,
    },
  };

  const slitCenterYMm = baseOriginYMm + slot.depthOffsetMm;
  let baseSlotRect: RectMm = {
    x: slot.centerXMm - slot.widthMm / 2,
    y: slitCenterYMm - slot.tabDepthMm / 2,
    width: slot.widthMm,
    height: slot.tabDepthMm,
  };

  const partGapMm = Math.max(0, options.partGapMm ?? 0);
  if (partGapMm > 0) {
    const figureBounds = boundsFromGeometry(contourMm, [neckRect, tabRect]);
    const baseDy = figureBounds.y + figureBounds.height + partGapMm - baseFootprint.bounds.y;
    baseFootprint = translateBaseFootprint(baseFootprint, 0, baseDy);
    baseSlotRect = translateRect(baseSlotRect, 0, baseDy);
  }

  let frame: RectMm | undefined;
  const framePaddingMm = Math.max(0, options.framePaddingMm ?? MARGIN_MM);
  if (options.includeFrame === true) {
    const contentBounds = boundsFromGeometry(contourMm, [
      neckRect,
      tabRect,
      baseFootprint.bounds,
      baseSlotRect,
    ]);
    frame = expandRect(contentBounds, framePaddingMm);
  }

  let geometry: ExportGeometryBody = {
    contour: contourMm,
    sharpCorners: slotJunctionCorners(slot).map(toMm),
    neck: neckRect,
    tab: tabRect,
    base: baseFootprint,
    baseSlot: baseSlotRect,
    image: imageRect,
    ...(frame ? { frame } : {}),
  };

  const outputRects = exportBoundsRects(geometry);
  const mirrorBounds = boundsFromGeometry(geometry.contour, outputRects);
  if (options.mirrorX === true) {
    geometry = mirrorExportGeometryX(geometry, mirrorBounds);
  }

  let layoutBounds = boundsFromGeometry(geometry.contour, exportBoundsRects(geometry));

  let tileBounds = layoutBounds;
  let tileRotationDeg: 0 | 90 = 0;
  let tileOffsets: Point[] = [{ x: 0, y: 0 }];
  let separatePartsLayout: SeparatePartsLayout | undefined;
  const pageSize = normalizedPageSize(options);
  const impositionGapMm = Math.max(0, options.impositionGapMm ?? 5);
  if (options.imposeA4 === true && options.separatePartsImposition === true) {
    const figureBounds = boundsFromGeometry(geometry.contour, [
      geometry.neck!,
      geometry.tab!,
      ...(options.includeImage ? [geometry.image] : []),
    ]);
    const baseBounds = boundsFromGeometry(geometry.base!.outline, [geometry.baseSlot!]);
    separatePartsLayout = computeSeparatePartsLayout(
      figureBounds,
      baseBounds,
      geometry.base!.outline,
      pageSize,
      impositionGapMm,
    );
  } else if (options.imposeA4 === true) {
    const a4MarginMm = 0;
    const dx = a4MarginMm - layoutBounds.x;
    const dy = a4MarginMm - layoutBounds.y;
    geometry = translateExportGeometry(geometry, dx, dy);
    layoutBounds = translateRect(layoutBounds, dx, dy);
    const normal = computeImpositionTileLayout(
      layoutBounds.width,
      layoutBounds.height,
      pageSize,
      impositionGapMm,
    );
    const rotated = computeImpositionTileLayout(
      layoutBounds.height,
      layoutBounds.width,
      pageSize,
      impositionGapMm,
    );
    tileRotationDeg = rotated.count > normal.count ? 90 : 0;
    tileOffsets = tileRotationDeg === 90 ? rotated.offsets : normal.offsets;
    tileBounds = layoutBounds;
  }

  const bounds = exportBoundsRects(geometry);

  return {
    ...geometry,
    tileBounds,
    tileRotationDeg,
    tileOffsets,
    ...(separatePartsLayout ? { separatePartsLayout } : {}),
    viewBox:
      options.imposeA4 === true
        ? { x: 0, y: 0, width: pageSize.width, height: pageSize.height }
        : computeViewBox(geometry.contour, bounds),
  };
}

function computeSeparatePartsLayout(
  figureBounds: RectMm,
  baseBounds: RectMm,
  baseOutline: readonly Point[],
  page: { width: number; height: number },
  gapMm: number,
): SeparatePartsLayout {
  type Candidate = { count: number; figures: PartPlacement[]; bases: PartPlacement[] };
  let best: Candidate = { count: 0, figures: [], bases: [] };
  const orientations: readonly (0 | 90)[] = [0, 90];
  const size = (bounds: RectMm, rotation: 0 | 90) =>
    rotation === 0
      ? { width: bounds.width, height: bounds.height }
      : { width: bounds.height, height: bounds.width };
  const grid = (
    region: RectMm,
    item: { width: number; height: number },
    rotationDeg: 0 | 90,
    gapX: number,
    gapY: number,
  ): PartPlacement[] => {
    const columns = Math.floor((region.width + gapX) / (item.width + gapX));
    const rows = Math.floor((region.height + gapY) / (item.height + gapY));
    if (columns < 1 || rows < 1) return [];
    const result: PartPlacement[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        result.push({
          x: region.x + column * (item.width + gapX),
          y: region.y + row * (item.height + gapY),
          rotationDeg,
        });
      }
    }
    return result;
  };

  // bbox の左右／上下それぞれに直線区間がある方向だけ、台座同士を密着可能にする。
  const tolerance = Math.max(baseBounds.width, baseBounds.height) * 1e-6;
  const hasEdge = (axis: 'x' | 'y', value: number): boolean =>
    baseOutline.some((point, index) => {
      const next = baseOutline[(index + 1) % baseOutline.length];
      return (
        next !== undefined &&
        Math.abs(point[axis] - value) <= tolerance &&
        Math.abs(next[axis] - value) <= tolerance &&
        Math.hypot(next.x - point.x, next.y - point.y) > tolerance
      );
    });
  const touchX = hasEdge('x', baseBounds.x) && hasEdge('x', baseBounds.x + baseBounds.width);
  const touchY = hasEdge('y', baseBounds.y) && hasEdge('y', baseBounds.y + baseBounds.height);
  const usable: RectMm = {
    x: gapMm,
    y: gapMm,
    width: Math.max(0, page.width - gapMm * 2),
    height: Math.max(0, page.height - gapMm * 2),
  };

  for (const figureRotation of orientations) {
    for (const baseRotation of orientations) {
      const fs = size(figureBounds, figureRotation);
      const bs = size(baseBounds, baseRotation);
      const baseGapX = (baseRotation === 0 ? touchX : touchY) ? 0 : gapMm;
      const baseGapY = (baseRotation === 0 ? touchY : touchX) ? 0 : gapMm;
      // 縦分割：左に絵柄、右に台座。分割線を絵柄の列境界で全探索する。
      for (
        let columns = 1;
        columns * fs.width + (columns - 1) * gapMm < usable.width;
        columns += 1
      ) {
        const figureWidth = columns * fs.width + (columns - 1) * gapMm;
        const figures = grid(
          { x: usable.x, y: usable.y, width: figureWidth, height: usable.height },
          fs,
          figureRotation,
          gapMm,
          gapMm,
        );
        const baseX = usable.x + figureWidth + gapMm;
        const bases = grid(
          { x: baseX, y: usable.y, width: usable.x + usable.width - baseX, height: usable.height },
          bs,
          baseRotation,
          baseGapX,
          baseGapY,
        );
        const count = Math.min(figures.length, bases.length);
        if (count > best.count) best = { count, figures, bases };
      }
      // 横分割：上に絵柄、下に台座。
      for (let rows = 1; rows * fs.height + (rows - 1) * gapMm < usable.height; rows += 1) {
        const figureHeight = rows * fs.height + (rows - 1) * gapMm;
        const figures = grid(
          { x: usable.x, y: usable.y, width: usable.width, height: figureHeight },
          fs,
          figureRotation,
          gapMm,
          gapMm,
        );
        const baseY = usable.y + figureHeight + gapMm;
        const bases = grid(
          { x: usable.x, y: baseY, width: usable.width, height: usable.y + usable.height - baseY },
          bs,
          baseRotation,
          baseGapX,
          baseGapY,
        );
        const count = Math.min(figures.length, bases.length);
        if (count > best.count) best = { count, figures, bases };
      }
    }
  }
  return {
    figureBounds,
    baseBounds,
    figurePlacements: best.figures.slice(0, best.count),
    basePlacements: best.bases.slice(0, best.count),
    setCount: best.count,
  };
}

function exportBoundsRects(geometry: ExportGeometryBody): RectMm[] {
  return [
    geometry.neck!,
    geometry.tab!,
    geometry.base!.bounds,
    geometry.baseSlot!,
    ...(geometry.frame ? [geometry.frame] : []),
  ];
}

function normalizedPageSize(options: ExportGeometryOptions): { width: number; height: number } {
  return {
    width: Math.max(1, options.impositionPageWidthMm ?? DEFAULT_IMPOSITION_PAGE_MM.width),
    height: Math.max(1, options.impositionPageHeightMm ?? DEFAULT_IMPOSITION_PAGE_MM.height),
  };
}

function translatePoint(point: Point, dx: number, dy: number): Point {
  return { x: point.x + dx, y: point.y + dy };
}

function translateRect(rect: RectMm, dx: number, dy: number): RectMm {
  return { ...rect, x: rect.x + dx, y: rect.y + dy };
}

function translateBaseFootprint(base: BaseFootprintMm, dx: number, dy: number): BaseFootprintMm {
  return {
    curve: mapCurve(base.curve, (p) => translatePoint(p, dx, dy)),
    outline: base.outline.map((p) => translatePoint(p, dx, dy)),
    bounds: translateRect(base.bounds, dx, dy),
  };
}

function translateExportGeometry(
  geometry: ExportGeometryBody,
  dx: number,
  dy: number,
): ExportGeometryBody {
  return {
    contour: geometry.contour.map((p) => translatePoint(p, dx, dy)),
    sharpCorners: geometry.sharpCorners.map((p) => translatePoint(p, dx, dy)),
    neck: translateRect(geometry.neck!, dx, dy),
    tab: translateRect(geometry.tab!, dx, dy),
    base: translateBaseFootprint(geometry.base!, dx, dy),
    baseSlot: translateRect(geometry.baseSlot!, dx, dy),
    image: translateRect(geometry.image, dx, dy),
    ...(geometry.frame ? { frame: translateRect(geometry.frame, dx, dy) } : {}),
  };
}

function mirrorPointX(point: Point, bounds: RectMm): Point {
  return { x: bounds.x + bounds.width - (point.x - bounds.x), y: point.y };
}

function mirrorRectX(rect: RectMm, bounds: RectMm): RectMm {
  return { ...rect, x: bounds.x + bounds.width - (rect.x - bounds.x) - rect.width };
}

function mirrorBaseFootprintX(base: BaseFootprintMm, bounds: RectMm): BaseFootprintMm {
  return {
    curve: mapCurve(base.curve, (p) => mirrorPointX(p, bounds)),
    outline: base.outline.map((p) => mirrorPointX(p, bounds)),
    bounds: mirrorRectX(base.bounds, bounds),
  };
}

function mirrorExportGeometryX(geometry: ExportGeometryBody, bounds: RectMm): ExportGeometryBody {
  return {
    contour: geometry.contour.map((p) => mirrorPointX(p, bounds)),
    sharpCorners: geometry.sharpCorners.map((p) => mirrorPointX(p, bounds)),
    neck: mirrorRectX(geometry.neck!, bounds),
    tab: mirrorRectX(geometry.tab!, bounds),
    base: mirrorBaseFootprintX(geometry.base!, bounds),
    baseSlot: mirrorRectX(geometry.baseSlot!, bounds),
    image: mirrorRectX(geometry.image, bounds),
    ...(geometry.frame ? { frame: mirrorRectX(geometry.frame, bounds) } : {}),
  };
}

function computeImpositionTileLayout(
  tileWidthMm: number,
  tileHeightMm: number,
  pageSize: { width: number; height: number },
  gapMm: number,
): { count: number; offsets: Point[] } {
  if (tileWidthMm <= 0 || tileHeightMm <= 0) {
    return { count: 1, offsets: [{ x: 0, y: 0 }] };
  }

  const pageMarginMm = gapMm;
  const gutterMm = gapMm;
  const usableWidth = pageSize.width - pageMarginMm * 2;
  const usableHeight = pageSize.height - pageMarginMm * 2;
  const columns = Math.max(1, Math.floor((usableWidth + gutterMm) / (tileWidthMm + gutterMm)));
  const rows = Math.max(1, Math.floor((usableHeight + gutterMm) / (tileHeightMm + gutterMm)));
  const occupiedWidth = columns * tileWidthMm + (columns - 1) * gutterMm;
  const occupiedHeight = rows * tileHeightMm + (rows - 1) * gutterMm;
  const originX = pageMarginMm + Math.max(0, (usableWidth - occupiedWidth) / 2);
  const originY = pageMarginMm + Math.max(0, (usableHeight - occupiedHeight) / 2);
  const offsets: Point[] = [];

  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      offsets.push({
        x: originX + column * (tileWidthMm + gutterMm),
        y: originY + row * (tileHeightMm + gutterMm),
      });
    }
  }

  return { count: columns * rows, offsets };
}

function expandRect(rect: RectMm, padding: number): RectMm {
  return {
    x: rect.x - padding,
    y: rect.y - padding,
    width: rect.width + padding * 2,
    height: rect.height + padding * 2,
  };
}

function boundsFromGeometry(points: readonly Point[], rects: readonly RectMm[]): RectMm {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of points) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const rect of rects) {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  }

  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys);

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** 穴の外接矩形。viewBox 計算用。 */
function holeRect(hole: { center: Point; radius: number }): RectMm {
  return {
    x: hole.center.x - hole.radius,
    y: hole.center.y - hole.radius,
    width: hole.radius * 2,
    height: hole.radius * 2,
  };
}

/** 頂点列と矩形群を包む境界（mm）に余白を足した領域を求める。 */
function computeViewBox(contour: readonly Point[], rects: readonly RectMm[]): RectMm {
  const xs: number[] = [];
  const ys: number[] = [];

  for (const p of contour) {
    xs.push(p.x);
    ys.push(p.y);
  }
  for (const rect of rects) {
    xs.push(rect.x, rect.x + rect.width);
    ys.push(rect.y, rect.y + rect.height);
  }

  const minX = Math.min(...xs) - MARGIN_MM;
  const minY = Math.min(...ys) - MARGIN_MM;
  const maxX = Math.max(...xs) + MARGIN_MM;
  const maxY = Math.max(...ys) + MARGIN_MM;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * 図全体の大きさに見合う線幅(mm)。
 * 対角の 0.3% とし、拡大率に依らず見やすい太さを保つ。極小図でも線が消えないよう
 * 0.2mm を下限にする。
 */
export function strokeWidthMm(viewBox: RectMm): number {
  return Math.max(0.2, Math.hypot(viewBox.width, viewBox.height) * 0.003);
}

/**
 * 矩形を閉じたパスの `d` 属性文字列へ変換する。
 * SVG は `<rect>` を持つが PDF（.ai）は矩形を含めすべてパスで描くため、両者が同じ
 * 形状を出すよう矩形のパス化をここに置く。曲線は不要なので直線 4 辺で閉じる。
 */
export function rectPathData(rect: RectMm, format: (value: number) => string = fmt): string {
  const f = format;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  return (
    `M ${f(rect.x)} ${f(rect.y)} L ${f(right)} ${f(rect.y)} ` +
    `L ${f(right)} ${f(bottom)} L ${f(rect.x)} ${f(bottom)} Z`
  );
}
