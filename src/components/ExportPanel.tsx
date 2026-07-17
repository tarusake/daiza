// エクスポート操作パネル。
//
// 解析結果を成果物（実寸座標系の SVG / Adobe Illustrator ドキュメント）として書き出す
// 操作だけを持つ。解析結果があって初めて意味を持つ操作なので、右列の解析結果パネルの
// 直下に置く。状態は保持せず、生成・ダウンロードは上位（App）に委ねる presentational
// コンポーネント。

import { Download } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { ImpositionPreview } from '@/components/ImpositionPreview';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import type { AnalysisResult } from '@/model/types';

export interface ExportSettings {
  partGapMm: number;
  includeFrame: boolean;
  framePaddingMm: number;
  imposeA4: boolean;
  impositionPageWidthMm: number;
  impositionPageHeightMm: number;
  redCutLinesOnly: boolean;
  mirrorArtwork: boolean;
}

export interface ExportPanelProps {
  /** SVG エクスポートを要求する。結果が無い場合は未指定で無効化される。 */
  onExportSvg?: () => void;
  /** Illustrator（.ai）エクスポートを要求する。結果が無い場合は未指定で無効化される。 */
  onExportAi?: () => void;
  /** カットラインだけの Illustrator（.ai）エクスポートを要求する。 */
  onExportCutlineAi?: () => void;
  /** 絵柄画像だけの PDF エクスポートを要求する。 */
  onExportImagePdf?: () => void;
  /** SVG に絵柄画像を埋め込むか（.ai は常に埋め込むため対象外）。 */
  embedImageInSvg: boolean;
  onEmbedImageInSvgChange: (value: boolean) => void;
  /** エクスポート時の配置設定。 */
  settings: ExportSettings;
  onSettingsChange: (settings: ExportSettings) => void;
  /** 面付けプレビュー用の解析結果。 */
  result: AnalysisResult | null;
  /** 面付けプレビューへ表示する絵柄画像。 */
  previewImageHref?: string;
  /** 生成中。大きな画像では PNG 化に時間がかかるため、その間は操作を止める。 */
  exporting?: boolean;
}

export function ExportPanel({
  onExportSvg,
  onExportAi,
  onExportCutlineAi,
  onExportImagePdf,
  embedImageInSvg,
  onEmbedImageInSvgChange,
  settings,
  onSettingsChange,
  result,
  previewImageHref,
  exporting = false,
}: ExportPanelProps) {
  const updateSettings = (patch: Partial<ExportSettings>) => {
    onSettingsChange({ ...settings, ...patch });
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>エクスポート</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="export-part-gap">絵と台座の間隔</Label>
          <div className="flex items-center gap-2">
            <Input
              id="export-part-gap"
              type="number"
              inputMode="decimal"
              min={0}
              max={200}
              step={1}
              value={settings.partGapMm}
              onChange={(event) => {
                const next = event.target.valueAsNumber;
                if (!Number.isNaN(next)) {
                  updateSettings({ partGapMm: Math.max(0, next) });
                }
              }}
              disabled={exporting}
            />
            <span className="text-muted-foreground w-8 shrink-0 text-sm">mm</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="export-include-frame"
            checked={settings.includeFrame}
            onCheckedChange={(checked) => updateSettings({ includeFrame: checked === true })}
            disabled={exporting}
          />
          <Label
            htmlFor="export-include-frame"
            className="text-muted-foreground text-sm font-normal"
          >
            枠をつける
          </Label>
        </div>

        {settings.includeFrame && (
          <div className="grid gap-1.5">
            <Label htmlFor="export-frame-padding">枠の余白</Label>
            <div className="flex items-center gap-2">
              <Input
                id="export-frame-padding"
                type="number"
                inputMode="decimal"
                min={0}
                max={50}
                step={1}
                value={settings.framePaddingMm}
                onChange={(event) => {
                  const next = event.target.valueAsNumber;
                  if (!Number.isNaN(next)) {
                    updateSettings({ framePaddingMm: Math.max(0, next) });
                  }
                }}
                disabled={exporting}
              />
              <span className="text-muted-foreground w-8 shrink-0 text-sm">mm</span>
            </div>
          </div>
        )}

        <div className="flex items-center gap-2">
          <Checkbox
            id="export-impose-a4"
            checked={settings.imposeA4}
            onCheckedChange={(checked) => updateSettings({ imposeA4: checked === true })}
            disabled={exporting}
          />
          <Label htmlFor="export-impose-a4" className="text-muted-foreground text-sm font-normal">
            面付けする
          </Label>
        </div>

        {settings.imposeA4 && (
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="export-imposition-page-width">面付け幅</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="export-imposition-page-width"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={2000}
                  step={1}
                  value={settings.impositionPageWidthMm}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    if (!Number.isNaN(next)) {
                      updateSettings({ impositionPageWidthMm: Math.max(1, next) });
                    }
                  }}
                  disabled={exporting}
                />
                <span className="text-muted-foreground w-8 shrink-0 text-sm">mm</span>
              </div>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="export-imposition-page-height">面付け高さ</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="export-imposition-page-height"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={2000}
                  step={1}
                  value={settings.impositionPageHeightMm}
                  onChange={(event) => {
                    const next = event.target.valueAsNumber;
                    if (!Number.isNaN(next)) {
                      updateSettings({ impositionPageHeightMm: Math.max(1, next) });
                    }
                  }}
                  disabled={exporting}
                />
                <span className="text-muted-foreground w-8 shrink-0 text-sm">mm</span>
              </div>
            </div>
          </div>
        )}

        <ImpositionPreview
          result={result}
          settings={settings}
          {...(previewImageHref !== undefined ? { imageHref: previewImageHref } : {})}
        />

        <div className="flex items-center gap-2">
          <Checkbox
            id="export-red-cut-lines-only"
            checked={settings.redCutLinesOnly}
            onCheckedChange={(checked) => updateSettings({ redCutLinesOnly: checked === true })}
            disabled={exporting}
          />
          <Label
            htmlFor="export-red-cut-lines-only"
            className="text-muted-foreground text-sm font-normal"
          >
            カットラインのみ赤で出力する
          </Label>
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="export-mirror-artwork"
            checked={settings.mirrorArtwork}
            onCheckedChange={(checked) => updateSettings({ mirrorArtwork: checked === true })}
            disabled={exporting}
          />
          <Label
            htmlFor="export-mirror-artwork"
            className="text-muted-foreground text-sm font-normal"
          >
            絵柄を左右反転する
          </Label>
        </div>

        {/* SVG 生成（実寸座標系）は onExportSvg に委ねる。解析結果が無ければ無効。 */}
        <Button
          type="button"
          className="w-full"
          disabled={!onExportSvg || exporting}
          onClick={onExportSvg}
        >
          <Download />
          SVGファイル (.svg)
        </Button>

        {/* SVG は線データのみが既定。絵柄が要る場合だけ画像を埋め込む（ファイルは重くなる）。 */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="embed-image-in-svg"
            checked={embedImageInSvg}
            onCheckedChange={(checked) => onEmbedImageInSvgChange(checked === true)}
            disabled={exporting}
          />
          <Label htmlFor="embed-image-in-svg" className="text-muted-foreground text-sm font-normal">
            SVGに絵柄画像を含める
          </Label>
        </div>

        {/* .ai は「絵柄付きのアウトライン」を得るための出力なので、画像を常に含める。 */}
        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={!onExportAi || exporting}
          onClick={onExportAi}
        >
          <Download />
          Illustrator ドキュメント (.ai)
        </Button>

        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={!onExportCutlineAi || exporting}
          onClick={onExportCutlineAi}
        >
          <Download />
          カットライン AI (.ai)
        </Button>

        <Button
          type="button"
          variant="secondary"
          className="w-full"
          disabled={!onExportImagePdf || exporting}
          onClick={onExportImagePdf}
        >
          <Download />
          絵柄画像 PDF (.pdf)
        </Button>
      </CardContent>
    </Card>
  );
}
