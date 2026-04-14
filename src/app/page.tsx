"use client";

import { useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import SophonSidebar from "@/components/SophonSidebar";
import EtchPanel from "@/components/EtchPanel";
import EntryHint from "@/components/EntryHint";
import type { SophonSceneHandle } from "@/components/SophonScene";

const SophonScene = dynamic(() => import("@/components/SophonScene"), {
  ssr: false,
});

const DEMO_CLAIMED = [
  { index: 0, claimed: true, nickname: "旅行者1" },
  { index: 1, claimed: true, nickname: "旅行者2" },
  { index: 2, claimed: true, nickname: "旅行者3" },
  { index: 3, claimed: true, nickname: "旅行者4" },
  { index: 4, claimed: true, nickname: "旅行者5" },
];

export default function Home() {
  const sceneRef = useRef<SophonSceneHandle>(null);

  const [selectedSophon, setSelectedSophon] = useState<{
    index: number;
    claimed: boolean;
    nickname: string;
  } | null>(null);

  const [etchingIndex, setEtchingIndex] = useState<number | null>(null);

  const handleSophonClick = useCallback((index: number) => {
    const demo = DEMO_CLAIMED.find((d) => d.index === index);
    setSelectedSophon(
      demo ?? { index, claimed: false, nickname: "" }
    );
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

  return (
    <main className="w-screen h-screen">
      <SophonScene ref={sceneRef} onSophonClick={handleSophonClick} />
      <EntryHint />
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
