"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import SophonSidebar from "@/components/SophonSidebar";
import EtchPanel from "@/components/EtchPanel";
import type { SophonSceneHandle } from "@/components/SophonScene";

const SophonScene = dynamic(() => import("@/components/SophonScene"), {
  ssr: false,
});

export default function SophonPage() {
  const params = useParams();
  const rawId = params.id as string;
  const sophonIndex = Math.max(0, parseInt(rawId, 10) - 1);
  const isValid = !isNaN(parseInt(rawId, 10)) && parseInt(rawId, 10) >= 1;

  const sceneRef = useRef<SophonSceneHandle>(null);

  const [selectedSophon, setSelectedSophon] = useState<{
    index: number;
    claimed: boolean;
    nickname: string;
  } | null>(null);

  const [etchingIndex, setEtchingIndex] = useState<number | null>(null);
  const [autoFocused, setAutoFocused] = useState(false);

  const handleSophonClick = useCallback((index: number) => {
    setSelectedSophon({ index, claimed: false, nickname: "" });
  }, []);

  const handleClose = useCallback(() => {
    setSelectedSophon(null);
  }, []);

  const handleClaim = useCallback((index: number) => {
    sceneRef.current?.triggerClaim(index);
    setSelectedSophon({
      index,
      claimed: true,
      nickname: "新认领者",
    });
  }, []);

  const handleEtch = useCallback((index: number) => {
    setEtchingIndex(index);
  }, []);

  const handleEtchSave = useCallback(
    (data: { nickname: string; bio: string; links: string[] }) => {
      if (etchingIndex !== null) {
        setSelectedSophon({
          index: etchingIndex,
          claimed: true,
          nickname: data.nickname || "匿名旅行者",
        });
      }
      setEtchingIndex(null);
    },
    [etchingIndex]
  );

  const handleEtchClose = useCallback(() => {
    setEtchingIndex(null);
  }, []);

  // Auto-open sidebar for the target sophon after scene loads
  useEffect(() => {
    if (isValid && !autoFocused) {
      const timer = setTimeout(() => {
        setSelectedSophon({
          index: sophonIndex,
          claimed: false,
          nickname: "",
        });
        setAutoFocused(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, [isValid, sophonIndex, autoFocused]);

  if (!isValid) {
    return (
      <main className="w-screen h-screen flex items-center justify-center text-white/50">
        <div className="text-center">
          <div className="text-4xl mb-4">∅</div>
          <div>智子编号无效</div>
          <a href="/" className="text-blue-300/60 hover:text-blue-300 text-sm mt-4 block">
            返回星海
          </a>
        </div>
      </main>
    );
  }

  return (
    <main className="w-screen h-screen">
      <SophonScene ref={sceneRef} onSophonClick={handleSophonClick} />
      <SophonSidebar
        sophon={selectedSophon}
        onClose={handleClose}
        onClaim={handleClaim}
        onEtch={handleEtch}
      />
      {etchingIndex !== null && (
        <EtchPanel
          sophonIndex={etchingIndex}
          initialNickname={selectedSophon?.nickname ?? ""}
          onSave={handleEtchSave}
          onClose={handleEtchClose}
        />
      )}
    </main>
  );
}
