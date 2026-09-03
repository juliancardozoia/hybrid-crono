/**
 * jsdom no implementa `<dialog>.showModal()` (ni siempre `close()`): sin esto,
 * cualquier test que abra un `Modal` (src/shared/components/Modal.tsx, sobre
 * `<dialog>` nativo) revienta con `TypeError: dialog.showModal is not a
 * function`, sin relación con el componente que se este probando.
 *
 * Es un polyfill MINIMO — lo unico que los componentes de esta app necesitan
 * es que abrir ponga el atributo `open` y que cerrar lo saque y dispare el
 * evento `close`, que es lo que `Modal` escucha para sincronizar su estado.
 * No simula el backdrop, el foco atrapado ni el "top layer": eso solo se
 * prueba a ojo en un navegador de verdad.
 *
 * `typeof HTMLDialogElement !== "undefined"` lo hace inofensivo en los tests
 * con `environment: "node"` (la mayoria: logica pura y tests de base), que no
 * tienen DOM y no cargan este archivo para nada.
 */
if (typeof HTMLDialogElement !== "undefined") {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
      this.setAttribute("open", "");
    };
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
