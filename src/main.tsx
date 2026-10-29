import ReactDOM from "react-dom/client";
// Establish layer order before components import their own stylesheets.
import "./tokens.css";
import "./index.css";
import "./voyage.css";
import "./components/ui.css";
import App from "./App";
import { syncNativeTheme } from "./theme";
import { initTypography } from "./typography";

syncNativeTheme();
initTypography();

// Note: no StrictMode — its dev double-mount would start `pi` twice.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
