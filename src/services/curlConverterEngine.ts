import { toJsonObject, toPython, toPythonWarn, type JSONOutput, type Warnings } from "curlconverter";

export interface CurlConverterResult {
  pythonCode: string;
  request: JSONOutput;
  warnings: Warnings;
}

export class CurlConverterError extends Error {
  constructor(message = "Unable to convert this cURL. Please check the cURL syntax.") {
    super(message);
    this.name = "CurlConverterError";
  }
}

export function convertCurlLocally(rawCurl: string): CurlConverterResult {
  const curl = rawCurl.trim();
  if (!curl || !/\bcurl\b/.test(curl)) {
    throw new CurlConverterError();
  }

  try {
    const [pythonCode, warnings] = toPythonWarn(curl);
    const request = toJsonObject(curl);
    if (!pythonCode.trim() || !request?.url) {
      throw new CurlConverterError();
    }
    return {
      pythonCode,
      request,
      warnings,
    };
  } catch (error) {
    if (error instanceof CurlConverterError) throw error;
    throw new CurlConverterError();
  }
}

export function convertCurlToPlainPython(rawCurl: string): string {
  try {
    return toPython(rawCurl.trim());
  } catch {
    throw new CurlConverterError();
  }
}
