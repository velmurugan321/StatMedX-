import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { AppProvider } from "./state";
import "./index.css";

class StartupBoundary extends React.Component<{children:React.ReactNode},{error:string|null}> {
  state={error:null as string|null};
  static getDerivedStateFromError(error:unknown) {
    return {error:error instanceof Error ? error.message : String(error)};
  }
  componentDidCatch(error:unknown, info:unknown) {
    console.error("StatMedX React startup error",error,info);
  }
  render() {
    if(this.state.error) return <main style={{minHeight:"100vh",padding:24,background:"#0f172a",color:"#f8fafc",fontFamily:"system-ui"}}>
      <h1 style={{fontSize:22,fontWeight:700}}>StatMedX could not start</h1>
      <p style={{marginTop:12,color:"#fca5a5",overflowWrap:"anywhere"}}>{this.state.error}</p>
      <p style={{marginTop:16,color:"#cbd5e1"}}>Please share this error message with support.</p>
    </main>;
    return this.props.children;
  }
}

const root=document.getElementById("root");
if(!root) throw new Error("StatMedX startup failed: root element #root is missing.");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <StartupBoundary>
      <AppProvider><App /></AppProvider>
    </StartupBoundary>
  </React.StrictMode>
);
