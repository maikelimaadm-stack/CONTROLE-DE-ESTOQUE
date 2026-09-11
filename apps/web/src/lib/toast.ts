import { toast as sonner } from "sonner";
import { notify } from "@/components/ui/mg-controls";

type Opts = { description?: string; duration?: number };
const show = (kind: "success" | "error" | "warning" | "info") => (message: string, opts?: Opts) => (opts?.description ? notify(kind, opts.description, { title: message, duration: opts.duration }) : notify(kind, message, { duration: opts?.duration }));
/** Mesma API do sonner, mas com o visual de aviso do modelo base (erp-toast-panel do MG). */
export const toast = { success: show("success"), error: show("error"), warning: show("warning"), info: show("info"), custom: sonner.custom, dismiss: sonner.dismiss, promise: sonner.promise };
