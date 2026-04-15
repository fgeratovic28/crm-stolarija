import React, { Component, ErrorInfo, ReactNode } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error:", error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
    window.location.reload();
  };

  private handleGoHome = () => {
    this.setState({ hasError: false, error: null });
    window.location.href = "/";
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-screen flex items-center justify-center p-4 bg-background">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-8 shadow-lg text-center">
            <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
            
            <h1 className="text-2xl font-bold text-foreground mb-2">Ups! Nešto nije u redu</h1>
            <p className="text-muted-foreground mb-8">
              Došlo je do neočekivane greške u aplikaciji. Naši inženjeri su obavešteni.
            </p>

            {import.meta.env.MODE === "development" && (
              <div className="mb-8 p-4 bg-muted rounded-lg text-left overflow-auto max-h-40">
                <p className="text-xs font-mono text-destructive">
                  {this.state.error?.toString()}
                </p>
              </div>
            )}

            <div className="flex flex-col gap-3">
              <Button onClick={this.handleReset} className="w-full">
                <RefreshCw className="w-4 h-4 mr-2" /> Pokušaj ponovo
              </Button>
              <Button onClick={this.handleGoHome} variant="outline" className="w-full">
                <Home className="w-4 h-4 mr-2" /> Vrati se na početnu
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
