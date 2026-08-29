// Record a viewport's canvas to a WebM file using MediaRecorder.
import { getViewportCanvas } from './renderingManager';

export async function recordViewportWebM(
  viewportId: string,
  durationMs = 4000,
): Promise<void> {
  const canvas = getViewportCanvas(viewportId);
  if (!canvas) return;
  const stream = (canvas as HTMLCanvasElement).captureStream(30);
  const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
    ? 'video/webm;codecs=vp9'
    : 'video/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime });
  const chunks: BlobPart[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: 'video/webm' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'viewport.webm';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  rec.start();
  setTimeout(() => rec.stop(), durationMs);
}
