import { runWithRotacionSourceTableAsync } from "@/lib/rotacion/source-context";
import { ROTACION_SOURCE_V4 } from "@/lib/rotacion/source-tables";
import { GET as rotacionGet, PUT as rotacionPut } from "@/app/api/rotacion/route";

export async function GET(request: Request) {
  return runWithRotacionSourceTableAsync(ROTACION_SOURCE_V4, () =>
    rotacionGet(request),
  );
}

export async function PUT(request: Request) {
  return runWithRotacionSourceTableAsync(ROTACION_SOURCE_V4, () =>
    rotacionPut(request),
  );
}
