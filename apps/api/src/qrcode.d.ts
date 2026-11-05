declare module "qrcode" {
  export interface SvgQrOptions {
    type: "svg";
    errorCorrectionLevel: "M";
    margin: number;
    width: number;
  }
  export function toString(text: string, options: SvgQrOptions): Promise<string>;
}
