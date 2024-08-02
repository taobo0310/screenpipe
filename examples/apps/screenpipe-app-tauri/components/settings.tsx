import React, { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/lib/hooks/use-settings";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Badge } from "@/components/ui/badge";
import { MemoizedReactMarkdown } from "./markdown";
import { Separator } from "@/components/ui/separator";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { invoke } from "@tauri-apps/api/core";
import { spinner } from "./spinner";

export function Settings({ className }: { className?: string }) {
  const { settings, updateSettings } = useSettings();
  const [localSettings, setLocalSettings] = React.useState(settings);
  const [isLoading, setIsLoading] = React.useState(false);

  const handleApiKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalSettings({ ...localSettings, openaiApiKey: e.target.value });
    updateSettings({ ...localSettings, openaiApiKey: e.target.value });
  };

  const handleOllamaToggle = (checked: boolean) => {
    console.log("checked", checked);
    setLocalSettings({ ...localSettings, useOllama: checked });
    updateSettings({ ...localSettings, useOllama: checked });
  };

  const handleCloudAudioToggle = async (checked: boolean) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      setLocalSettings({ ...localSettings, useCloudAudio: checked });
      await updateSettings({ ...localSettings, useCloudAudio: checked });
      // Restart screenpipe with new settings
      await restartScreenpipe();
      // user feedback
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Failed to update cloud audio setting:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCloudOCRToggle = async (checked: boolean) => {
    if (isLoading) return;
    setIsLoading(true);
    try {
      setLocalSettings({ ...localSettings, useCloudOcr: checked });
      await updateSettings({ ...localSettings, useCloudOcr: checked });
      // Restart screenpipe with new settings
      await restartScreenpipe();
      // user feedback
      await new Promise((resolve) => setTimeout(resolve, 1000));
    } catch (error) {
      console.error("Failed to update cloud OCR setting:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const restartScreenpipe = async () => {
    try {
      await invoke("kill_all_sreenpipes");
      // sleep 1s
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await invoke("spawn_screenpipe");
    } catch (error) {
      console.error("Failed to restart screenpipe:", error);
    }
  };

  React.useEffect(() => {
    setLocalSettings(settings);
  }, [settings]);

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          location.reload(); // ! HACK to properly refresh stuff (tood beter)
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="ghost" className={className}>
          Settings
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-[80vw] w-full max-h-[80vh] h-full overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Choose your AI provider, enter necessary credentials, and more.
          </DialogDescription>
        </DialogHeader>
        <div className="mt-8 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-center">OpenAI</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="w-full max-w-md">
                <div className="flex items-center gap-4 mb-4">
                  <Label htmlFor="apiKey" className="min-w-[80px] text-right">
                    API Key
                  </Label>
                  <Input
                    id="apiKey"
                    value={settings.openaiApiKey}
                    onChange={handleApiKeyChange}
                    className="flex-grow"
                    placeholder="Enter your OpenAI API Key"
                  />
                </div>
              </div>
              <p className="mt-2 text-sm text-muted-foreground text-center">
                OpenAI&apos;s GPT models are currently the most reliable for
                this application.
              </p>
              <p className="mt-1 text-sm text-muted-foreground text-center">
                Don&apos;t have an API key? Get one from{" "}
                <a
                  href="https://platform.openai.com/api-keys"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  OpenAI&apos;s website
                </a>
                .
              </p>
            </CardContent>
          </Card>

          <Separator />

          <Card>
            <CardHeader>
              <CardTitle className="text-center">
                Alternative AI Providers
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex flex-col items-center space-y-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div className="flex items-center space-x-4">
                        <Switch
                          id="use-ollama"
                          checked={localSettings.useOllama}
                          onCheckedChange={handleOllamaToggle}
                        />
                        <Label
                          htmlFor="use-ollama"
                          className="flex items-center space-x-2"
                        >
                          Use Ollama
                          <Badge variant="outline" className="ml-2">
                            Beta
                          </Badge>
                        </Label>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent>
                      <p>
                        Toggle to use Ollama instead of OpenAI API. Expect
                        errors as this is experimental.
                        <br />
                        Function calling was just announced and doesn&apos;t
                        work well, usually requiring more prompt engineering
                        compared to OpenAI.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
                <div className="text-sm text-muted-foreground mt-1">
                  <MemoizedReactMarkdown
                    components={{
                      a: ({ href, children }) => (
                        <a
                          className="text-primary hover:underline"
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {children}
                        </a>
                      ),
                      code: ({ children }) => (
                        <code className="px-1 py-0.5 rounded-sm bg-gray-100 dark:bg-gray-800 font-mono text-sm">
                          {children}
                        </code>
                      ),
                    }}
                  >
                    You need to [install Ollama](https://ollama.com/) and run
                    `ollama run llama3.1` first. Currently only supports Llama
                    3.1.
                  </MemoizedReactMarkdown>
                </div>
              </div>

              <Separator />

              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="flex items-center justify-center space-x-4">
                      <Switch
                        id="use-embedded-llm"
                        checked={false}
                        disabled={true}
                      />
                      <Label
                        htmlFor="use-embedded-llm"
                        className="flex items-center space-x-2"
                      >
                        Use Embedded LLM
                        <Badge variant="outline" className="ml-2">
                          Soon
                        </Badge>
                      </Label>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>
                      Embedded LLM support coming soon. Run locally without
                      installation. No need Ollama.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>

              <div className="flex flex-col items-center space-y-2">
                <div className="flex items-center space-x-4">
                  <Switch
                    id="use-cloud-audio"
                    checked={localSettings.useCloudAudio}
                    onCheckedChange={handleCloudAudioToggle}
                    disabled={isLoading}
                  />
                  <Label
                    htmlFor="use-cloud-audio"
                    className="flex items-center space-x-2"
                  >
                    Use Cloud Audio Processing
                  </Label>
                  {isLoading && (
                    <div className="ml-4 h-[24px] flex flex-row items-center flex-1 space-y-2 overflow-hidden px-1">
                      {spinner}
                    </div>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1 text-center">
                  <p>
                    Toggle to use cloud-based audio processing instead of local
                    processing. Cloud processing may provide better accuracy but
                    requires an internet connection. This will restart
                    screenpipe background process.
                  </p>
                </div>
              </div>

              <div className="flex flex-col items-center space-y-2">
                <div className="flex items-center space-x-4">
                  <Switch
                    id="use-cloud-ocr"
                    checked={localSettings.useCloudOcr}
                    onCheckedChange={handleCloudOCRToggle}
                    disabled={isLoading}
                  />
                  <Label
                    htmlFor="use-cloud-ocr"
                    className="flex items-center space-x-2"
                  >
                    Use Cloud OCR Processing
                  </Label>
                  {isLoading && (
                    <div className="ml-4 h-[24px] flex flex-row items-center flex-1 space-y-2 overflow-hidden px-1">
                      {spinner}
                    </div>
                  )}
                </div>
                <div className="text-sm text-muted-foreground mt-1 text-center">
                  <p>
                    Toggle to use cloud-based OCR processing instead of local
                    processing. Cloud processing may provide better accuracy but
                    requires an internet connection. This will restart
                    screenpipe background process.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </DialogContent>
    </Dialog>
  );
}
