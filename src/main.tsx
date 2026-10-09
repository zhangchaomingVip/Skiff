import ReactDOM from "react-dom/client";
import App from "./App";
import "./tokens.css";
import "./index.css";
import "./voyage.css";
import "./components/ui.css";
import { syncNativeTheme } from "./theme";

syncNativeTheme();

// Note: no StrictMode — its dev double-mount would start `pi` twice.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
