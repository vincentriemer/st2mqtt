declare module "fast-cli/api.js" {
  import Observable from "zen-observable";

  export interface FastOptions {
    measureUpload?: boolean;
  }

  export interface FastResult {
    downloadSpeed: number;
    uploadSpeed: number;
    downloadUnit: string;
    downloaded: number;
    uploadUnit: string;
    uploaded: number;
    latency: number;
    bufferBloat: number;
    userLocation: string;
    userIp: string;
    isDone: boolean;
  }

  function start(options: FastOptions): Observable<FastResult>;

  export default start;
}
