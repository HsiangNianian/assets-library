import type {
  ApiErrorDetail,
  ApiV1ErrorCode,
} from "@/shared/contracts";

export class ApiV1Error extends Error {
  constructor(
    public readonly code: ApiV1ErrorCode,
    message: string,
    public readonly status: number,
    public readonly details?: ApiErrorDetail[],
  ) {
    super(message);
    this.name = "ApiV1Error";
  }
}
