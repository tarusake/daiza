// 面付けプレビュー。
//
// エクスポートと同じ buildExportGeometry を使い、SVG / .ai に出るタイル配置を右パネルで
// 確認できるようにする。ここで独自に行列数を計算すると出力とプレビューがズレるため、
// 描画だけを React JSX へ写している。

import { useMemo } from 'react';

import {
  buildExportGeometry,
  exportColors,
  fmt,
  placePartPoint,
  strokeWidthMm,
  type ExportGeometry,
  type PartPlacement,
  type RectMm,
} from '@/export/geometry';
import type { AnalysisResult, Point } from '@/model/types';
import { closedCurvePathData, curvePathData, mapCurve } from '@/utils/curve';

export interface ImpositionPreviewSettings {
  partGapMm: number;
  includeFrame: boolean;
  framePaddingMm: number;
  imposeA4: boolean;
  separatePartsImposition: boolean;
  impositionGapMm: number;
  impositionPageWidthMm: number;
  impositionPageHeightMm: number;
  redCutLinesOnly: boolean;
  mirrorArtwork: boolean;
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

function rectPathForPlacement(rect: RectMm, bounds: RectMm, placement: PartPlacement): string {
  const corners = [
    { x: rect.x, y: rect.y },
    { x: rect.x + rect.width, y: rect.y },
    { x: rect.x + rect.width, y: rect.y + rect.height },
    { x: rect.x, y: rect.y + rect.height },
  ].map((p) => placePartPoint(p, bounds, placement));
  return `M ${fmt(corners[0]!.x)} ${fmt(corners[0]!.y)} L ${fmt(corners[1]!.x)} ${fmt(corners[1]!.y)} L ${fmt(corners[2]!.x)} ${fmt(corners[2]!.y)} L ${fmt(corners[3]!.x)} ${fmt(corners[3]!.y)} Z`;
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
      imposeA4: settings.imposeA4,
      separatePartsImposition: settings.separatePartsImposition,
      impositionGapMm: settings.impositionGapMm,
      impositionPageWidthMm: settings.impositionPageWidthMm,
      impositionPageHeightMm: settings.impositionPageHeightMm,
      mirrorX: settings.mirrorArtwork,
    });
  }, [result, imageHref, settings]);

  if (!geometry) {
    const aspectRatio = `${settings.impositionPageWidthMm} / ${settings.impositionPageHeightMm}`;
    return (
      <div
        className="bg-muted/30 text-muted-foreground flex items-center justify-center rounded border text-sm"
        style={{ aspectRatio }}
      >
        —
      </div>
    );
  }

  const strokeWidth = strokeWidthMm(geometry.viewBox);
  const colors = exportColors(settings.redCutLinesOnly);
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
          aria-label={settings.imposeA4 ? '面付けプレビュー' : '書き出しプレビュー'}
        >
          <rect
            x={geometry.viewBox.x}
            y={geometry.viewBox.y}
            width={geometry.viewBox.width}
            height={geometry.viewBox.height}
            fill="white"
          />
          {settings.imposeA4 && (
            <rect
              x={geometry.viewBox.x + strokeWidth / 2}
              y={geometry.viewBox.y + strokeWidth / 2}
              width={Math.max(0, geometry.viewBox.width - strokeWidth)}
              height={Math.max(0, geometry.viewBox.height - strokeWidth)}
              fill="none"
              stroke="#64748b"
              strokeWidth={strokeWidth}
            />
          )}
          {geometry.separatePartsLayout && (
            <>
              {geometry.separatePartsLayout.figurePlacements.map((placement, index) => {
                const bounds = geometry.separatePartsLayout!.figureBounds;
                const contour = geometry.contour.map((p) => placePartPoint(p, bounds, placement));
                const sharpCorners = geometry.sharpCorners.map((p) =>
                  placePartPoint(p, bounds, placement),
                );
                const imageTransformValue =
                  placement.rotationDeg === 0
                    ? `translate(${fmt(placement.x - bounds.x)} ${fmt(placement.y - bounds.y)})`
                    : `matrix(0 1 -1 0 ${fmt(placement.x + bounds.height + bounds.y)} ${fmt(placement.y - bounds.x)})`;
                return (
                  <g key={`figure-${index}`} fill="none" strokeLinejoin="round">
                    {imageHref !== undefined && (
                      <image
                        {...geometry.image}
                        href={imageHref}
                        preserveAspectRatio="none"
                        transform={imageTransformValue}
                      />
                    )}
                    <path
                      d={closedCurvePathData(contour, fmt, { sharpCorners })}
                      stroke={colors.contour}
                      strokeWidth={strokeWidth}
                    />
                    {!settings.redCutLinesOnly && (
                      <>
                        <path
                          d={rectPathForPlacement(geometry.neck!, bounds, placement)}
                          stroke={colors.slot}
                          strokeWidth={strokeWidth}
                        />
                        <path
                          d={rectPathForPlacement(geometry.tab!, bounds, placement)}
                          stroke={colors.slot}
                          strokeWidth={strokeWidth}
                        />
                      </>
                    )}
                  </g>
                );
              })}
              {geometry.separatePartsLayout.basePlacements.map((placement, index) => {
                const bounds = geometry.separatePartsLayout!.baseBounds;
                const baseCurve = mapCurve(geometry.base!.curve, (p) =>
                  placePartPoint(p, bounds, placement),
                );
                return (
                  <g key={`base-${index}`} fill="none" strokeLinejoin="round">
                    <path
                      d={curvePathData(baseCurve, fmt)}
                      stroke={colors.base}
                      strokeWidth={strokeWidth}
                    />
                    <path
                      d={rectPathForPlacement(geometry.baseSlot!, bounds, placement)}
                      stroke={colors.baseSlot}
                      strokeWidth={strokeWidth}
                    />
                  </g>
                );
              })}
            </>
          )}
          {!geometry.separatePartsLayout &&
            geometry.tileOffsets.map((offset, index) => {
              const contour = geometry.contour.map((p) => tilePoint(geometry, offset, p));
              const sharpCorners = geometry.sharpCorners.map((p) => tilePoint(geometry, offset, p));
              const baseCurve = mapCurve(geometry.base!.curve, (p) =>
                tilePoint(geometry, offset, p),
              );

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
                    stroke={colors.contour}
                    strokeWidth={strokeWidth}
                  />
                  {!settings.redCutLinesOnly && (
                    <>
                      <path
                        d={rectPathForTile(geometry, offset, geometry.neck!)}
                        stroke={colors.slot}
                        strokeWidth={strokeWidth}
                      />
                      <path
                        d={rectPathForTile(geometry, offset, geometry.tab!)}
                        stroke={colors.slot}
                        strokeWidth={strokeWidth}
                      />
                    </>
                  )}
                  <path
                    d={curvePathData(baseCurve, fmt)}
                    stroke={colors.base}
                    strokeWidth={strokeWidth}
                  />
                  <path
                    d={rectPathForTile(geometry, offset, geometry.baseSlot!)}
                    stroke={colors.baseSlot}
                    strokeWidth={strokeWidth}
                  />
                  {geometry.frame !== undefined && (
                    <path
                      d={rectPathForTile(geometry, offset, geometry.frame)}
                      stroke={colors.frame}
                      strokeWidth={strokeWidth}
                    />
                  )}
                </g>
              );
            })}
        </svg>
      </div>
      <div className="text-muted-foreground flex justify-between text-xs tabular-nums">
        <span>{geometry.separatePartsLayout?.setCount ?? geometry.tileOffsets.length} セット</span>
        <span>
          {fmt(geometry.viewBox.width)} × {fmt(geometry.viewBox.height)} mm /{' '}
          {geometry.tileRotationDeg}°
        </span>
      </div>
    </div>
  );
}
