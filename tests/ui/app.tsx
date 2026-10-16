import { createRoot } from "react-dom/client";
import App from "../../src/App";
import "@fontsource/noto-sans-arabic/400.css";
import "@fontsource/noto-sans-arabic/600.css";
import "@fontsource/noto-sans-arabic/800.css";
import "../../src/style.css";
createRoot(document.getElementById("root")!).render(<App />);
