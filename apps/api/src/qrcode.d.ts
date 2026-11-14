declare module "qrcode" {
  export interface SvgQrOptions {
    type: "svg";
    errorCorrectionLevel: "M";
    margin: number;
    width: number;
  }
  export interface PngQrOptions {
    type: "image/png";
    errorCorrectionLevel: "M";
    margin: number;
    width: number;
  }
  export function toDataURL(
    text: string,
    options: PngQrOptions,
  ): Promise<string>;
  export function toString(
    text: string,
    options: SvgQrOptions,
  ): Promise<string>;
}
