// One-time Cornerstone3D (v5) bootstrap: core, DICOM image loader (+ web
// workers), tools, and the streaming volume loader used for MPR.

import {
  init as coreInit,
  volumeLoader,
  cornerstoneStreamingImageVolumeLoader,
  cornerstoneStreamingDynamicImageVolumeLoader,
} from '@cornerstonejs/core';
import { init as dicomImageLoaderInit } from '@cornerstonejs/dicom-image-loader';
import { init as toolsInit } from '@cornerstonejs/tools';
import { MAX_WEB_WORKERS } from './config';

let started: Promise<void> | null = null;

export function initCornerstone(): Promise<void> {
  if (started) return started;
  started = (async () => {
    await coreInit();

    // Register the streaming volume loaders BEFORE anything asks for a volume.
    volumeLoader.registerVolumeLoader(
      'cornerstoneStreamingImageVolume',
      cornerstoneStreamingImageVolumeLoader as never,
    );
    volumeLoader.registerVolumeLoader(
      'cornerstoneStreamingDynamicImageVolume',
      cornerstoneStreamingDynamicImageVolumeLoader as never,
    );
    volumeLoader.registerUnknownVolumeLoader(
      cornerstoneStreamingImageVolumeLoader as never,
    );

    // DICOM image loader: wires cornerstone + dicomParser, registers the
    // wadors/wadouri image loaders + metadata providers, starts the worker pool.
    // `useLegacyMetadataProvider` keeps the classic wadouri path (parse a raw
    // P10 file, read pixel data) — the v5 "naturalized metadata" path can't
    // extract pixels from uncompressed local files.
    dicomImageLoaderInit({
      maxWebWorkers: MAX_WEB_WORKERS,
      useLegacyMetadataProvider: true,
    });

    await toolsInit();
  })();
  return started;
}
