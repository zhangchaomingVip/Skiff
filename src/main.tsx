import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

// Note: no StrictMode — its dev double-mount would start `pi` twice.
ReactDOM.createRoot(document.getElementById("root")!).render(<App />);
