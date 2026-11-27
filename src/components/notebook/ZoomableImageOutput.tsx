import { useEffect, useRef, useState } from 'react';
import { Minus, Plus } from 'lucide-react';
import { t } from '../../i18n';
import { listenForNotebookPinch } from './notebookZoom';

const DEFAULT_IMAGE_ZOOM = 100;
const MIN_IMAGE_ZOOM = 25;
const MAX_IMAGE_ZOOM = 400;
const IMAGE_ZOOM_STEP = 25;

function clampImageZoom(zoom: number): number {
  return Math.min(MAX_IMAGE_ZOOM, Math.max(MIN_IMAGE_ZOOM, zoom));
}

type ImageOutput = { src: string; svg?: never } | { src?: never; svg: string };

export function ZoomableImageOutput({ src, svg }: ImageOutput) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(DEFAULT_IMAGE_ZOOM);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    return listenForNotebookPinch(viewport, (factor) => {
      setZoom((current) => clampImageZoom(current * factor));
    });
  }, []);

  useEffect(() => {
    setZoom(DEFAULT_IMAGE_ZOOM);
    viewportRef.current?.scrollTo(0, 0);
  }, [src, svg]);

  const resetLabel = t('Reset image zoom ({zoom}%)', { zoom: Math.round(zoom) });

  return (
    <div className="notebook-image-output">
      <div role="group" aria-label={t('Image zoom')} className="nb-zoom-controls notebook-image-output__controls">
        <button
          type="button"
          aria-label={t('Zoom out')}
          title={t('Zoom out')}
          disabled={zoom <= MIN_IMAGE_ZOOM}
          onClick={() => setZoom((current) => clampImageZoom(Math.round(current) - IMAGE_ZOOM_STEP))}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          aria-label={resetLabel}
          title={resetLabel}
          className="nb-zoom-controls__level"
          onClick={() => setZoom(DEFAULT_IMAGE_ZOOM)}
        >
          {Math.round(zoom)}%
        </button>
        <button
          type="button"
          aria-label={t('Zoom in')}
          title={t('Zoom in')}
          disabled={zoom >= MAX_IMAGE_ZOOM}
          onClick={() => setZoom((current) => clampImageZoom(Math.round(current) + IMAGE_ZOOM_STEP))}
        >
          <Plus size={14} />
        </button>
      </div>
      <div ref={viewportRef} className="notebook-image-output__viewport" data-notebook-image-zoom>
        {svg !== undefined ? (
          <div
            role="img"
            aria-label={t('Plot output')}
            className="notebook-image-output__media"
            style={{ zoom: zoom / 100 }}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        ) : (
          <div className="notebook-image-output__media" style={{ zoom: zoom / 100 }}>
            <img src={src} alt={t('Plot output')} />
          </div>
        )}
      </div>
    </div>
  );
}
