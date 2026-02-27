import { MainLayout } from "@/components/layout/MainLayout";
import { ToastProvider } from "@/components/ui/Toast";
import "./App.css";

function App() {
  return (
    <ToastProvider>
      <MainLayout />
    </ToastProvider>
  );
}

export default App;
