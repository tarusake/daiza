// A4 面付けプレビュー。
//
// エクスポートと同じ buildExportGeometry を使い、SVG / .ai に出るタイル配置を右パネルで
// 確認できるようにする。ここで独自に行列数を計算すると出力とプレビューがズレるため、
// 描画だけを React JSX へ写している。

import { useMemo } from 'react';

import {
  A4_PAGE_MM,
  buildExportGeometry,
  EXPORT_COLORS,
  fmt,
  strokeWidthMm,
  type ExportGeometry,
  type RectMm,
} from '@/export/geometry';
import type { AnalysisResult, Point } from '@/model/types';
import { closedCurvePathData, curvePathData, mapCurve } from '@/utils/curve';

export interface ImpositionPreviewSettings {
  partGapMm: number;
  includeFrame: boolean;
  framePaddingMm: number;
}

export interface ImpositionPreviewProps {
  result: AnalysisResult | null;
  settings: ImpositionPreviewSettings;
  imageHref?: string;
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

function imageTransform(geometry: ExportGeometry, offset: Point): string {
  if (geometry.tileRotationDeg === 0) {
    return `translate(${fmt(offset.x)} ${fmt(offset.y)})`;
  }

  const bounds = geometry.tileBounds;
  const e = bounds.x + offset.x + bounds.height + bounds.y;
  const f = bounds.y + offset.y - bounds.x;
  return `matrix(0 1 -1 0 ${fmt(e)} ${fmt(f)})`;
}

export function ImpositionPreview({ result, settings, imageHref }: ImpositionPreviewProps) {
  const geometry = useMemo(() => {
    if (!result) {
      return null;
    }
    return buildExportGeometry(result, {
      includeImage: imageHref !== undefined,
      partGapMm: settings.partGapMm,
      includeFrame: settings.includeFrame,
      framePaddingMm: settings.framePaddingMm,
      imposeA4: true,
    });
  }, [result, imageHref, settings]);

  if (!geometry) {
    return (
      <div className="bg-muted/30 text-muted-foreground flex aspect-[210/297] items-center justify-center rounded border text-sm">
        —
      </div>
    );
  }

  const strokeWidth = strokeWidthMm(geometry.viewBox);
  const viewBox = `${fmt(geometry.viewBox.x)} ${fmt(geometry.viewBox.y)} ${fmt(
    geometry.viewBox.width,
  )} ${fmt(geometry.viewBox.height)}`;

  return (
    <div className="grid gap-2">
      <div className="bg-muted/30 overflow-hidden rounded border">
        <svg
          className="block h-auto w-full"
          viewBox={viewBox}
          role="img"
          aria-label="A4面付けプレビュー"
        >
          <rect
            x={0}
            y={0}
            width={A4_PAGE_MM.width}
            height={A4_PAGE_MM.height}
            fill="white"
          />
          {geometry.tileOffsets.map((offset, index) => {
            const contour = geometry.contour.map((p) => tilePoint(geometry, offset, p));
            const sharpCorners = geometry.sharpCorners.map((p) => tilePoint(geometry, offset, p));
            const baseCurve = mapCurve(geometry.base.curve, (p) => tilePoint(geometry, offset, p));

            return (
              <g key={`${offset.x}-${offset.y}-${index}`} fill="none" strokeLinejoin="round">
                {imageHref !== undefined && (
                  <image
                    href={imageHref}
                    x={geometry.image.x}
                    y={geometry.image.y}
                    width={geometry.image.width}
                    height={geometry.image.height}
                    preserveAspectRatio="none"
                    transform={imageTransform(geometry, offset)}
                  />
                )}
                <path
                  d={closedCurvePathData(contour, fmt, { sharpCorners })}
                  stroke={EXPORT_COLORS.contour}
                  strokeWidth={strokeWidth}
                />
                <path
                  d={rectPathForTile(geometry, offset, geometry.neck)}
                  stroke={EXPORT_COLORS.slot}
                  strokeWidth={strokeWidth}
                />
                <path
                  d={rectPathForTile(geometry, offset, geometry.tab)}
                  stroke={EXPORT_COLORS.slot}
                  strokeWidth={strokeWidth}
                />
                <path
                  d={curvePathData(baseCurve, fmt)}
                  stroke={EXPORT_COLORS.base}
                  strokeWidth={strokeWidth}
                />
                <path
                  d={rectPathForTile(geometry, offset, geometry.baseSlot)}
                  stroke={EXPORT_COLORS.slot}
                  strokeWidth={strokeWidth}
                />
                {geometry.frame !== undefined && (
                  <path
                    d={rectPathForTile(geometry, offset, geometry.frame)}
                    stroke={EXPORT_COLORS.frame}
                    strokeWidth={strokeWidth}
                  />
                )}
              </g>
            );
          })}
        </svg>
      </div>
      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{geometry.tileOffsets.length} 個</span>
        <span>{geometry.tileRotationDeg}°</span>
      </div>
    </div>
  );
}
