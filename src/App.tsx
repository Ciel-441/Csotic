import { AppShell } from "./layouts/AppShell";
import { GlobalDialogProvider } from "./components/GlobalDialog";

/**
 * Root App Component.
 * Per the specification, the AppShell is the permanent container
 * for every engineering workflow and never disappears during operation.
 */
export default function App() {
  return (
    <>
      <GlobalDialogProvider />
      <AppShell />
    </>
  );
}
