import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { UploadService } from './upload.service';

@Controller('api/upload')
export class UploadController {
  constructor(private readonly upload: UploadService) {}

  /**
   * multipart/form-data:
   *   files[]           — DICOM P10 files (a whole series/study folder)
   *   referringDoctorName, referringDoctorMobile, branchId,
   *   patientHistory, remarks, tags (comma-separated) — optional
   */
  @Post()
  @UseInterceptors(
    FilesInterceptor('files', 5000, {
      limits: { fileSize: 60 * 1024 * 1024, files: 5000 },
    }),
  )
  async ingest(
    @UploadedFiles() files: Array<{ buffer: Buffer; originalname: string }>,
    @Body() body: Record<string, string>,
  ) {
    if (!files?.length) throw new BadRequestException('no files');
    const result = await this.upload.ingest(files, {
      referringDoctorName: body.referringDoctorName,
      referringDoctorMobile: body.referringDoctorMobile,
      branchId: body.branchId,
      patientHistory: body.patientHistory,
      remarks: body.remarks,
      tags: body.tags
        ? body.tags.split(',').map((t) => t.trim()).filter(Boolean)
        : undefined,
    });
    if (!result.created.length) {
      throw new BadRequestException(
        `no valid DICOM found (${result.rejected} file(s) rejected)`,
      );
    }
    return result;
  }
}
