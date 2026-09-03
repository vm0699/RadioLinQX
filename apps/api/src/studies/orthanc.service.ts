import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import { config } from '../config';

/**
 * Small typed wrapper over Orthanc's REST + DICOMweb API.
 * Only the read paths the viewer needs today.
 */
@Injectable()
export class OrthancService {
  private readonly log = new Logger(OrthancService.name);
  private readonly http: AxiosInstance;

  constructor() {
    this.http = axios.create({
      baseURL: config.orthancUrl || undefined,
      auth: { username: config.orthancUser, password: config.orthancPass },
      timeout: 5_000,
    });
  }

  async ping(): Promise<boolean> {
    if (!config.orthancEnabled) return false;
    try {
      await this.http.get('/system');
      return true;
    } catch {
      return false;
    }
  }

  /** QIDO-RS study search, passed through with the caller's query string. */
  async searchStudies(query: Record<string, unknown>): Promise<unknown[]> {
    const { data } = await this.http.get('/dicom-web/studies', { params: query });
    return Array.isArray(data) ? data : [];
  }

  /** QIDO-RS series for one study. */
  async searchSeries(studyUid: string): Promise<unknown[]> {
    const { data } = await this.http.get(
      `/dicom-web/studies/${encodeURIComponent(studyUid)}/series`,
    );
    return Array.isArray(data) ? data : [];
  }
}
