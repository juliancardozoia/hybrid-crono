import {
  render as renderOriginal,
  type RenderOptions,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { ProveedorDeCarga } from "@/shared/components/Carga";
import { ProveedorDeNotificaciones } from "@/shared/components/Notificaciones";

/**
 * `render` con los mismos proveedores que el layout raiz de la app
 * (`src/app/layout.tsx`): el overlay de carga y los toasts.
 *
 * Sin esto, cualquier componente que use `useCarga`/`useCargaMientras` o
 * `useNotificaciones`/`useToastDeEstado` —directo, o indirecto via
 * `BotonDeEnvio`, `BotonesDeModal` o `FormularioDeEstado`— revienta en un test
 * con "useCarga() necesita <ProveedorDeCarga> en un ancestro.", sin relacion
 * con lo que el test intenta probar. Es el mismo motivo por el que existe
 * `setup-dom.ts` para `<dialog>`: el hueco es del ENTORNO de test, no del
 * componente, asi que se tapa una vez aca y no en cada archivo.
 */
export function render(ui: ReactElement, options?: RenderOptions) {
  return renderOriginal(
    <ProveedorDeCarga>
      <ProveedorDeNotificaciones>{ui}</ProveedorDeNotificaciones>
    </ProveedorDeCarga>,
    options,
  );
}

export * from "@testing-library/react";
