"use client";

import { useState } from "react";

interface EtchPanelProps {
  sophonIndex: number;
  initialNickname: string;
  onSave: (data: { nickname: string; bio: string; links: string[] }) => void;
  onClose: () => void;
}

export default function EtchPanel({
  sophonIndex,
  initialNickname,
  onSave,
  onClose,
}: EtchPanelProps) {
  const [nickname, setNickname] = useState(initialNickname);
  const [bio, setBio] = useState("");
  const [links, setLinks] = useState<string[]>([""]);

  const addLink = () => {
    if (links.length < 5) setLinks([...links, ""]);
  };

  const updateLink = (i: number, val: string) => {
    const next = [...links];
    next[i] = val;
    setLinks(next);
  };

  const removeLink = (i: number) => {
    setLinks(links.filter((_, idx) => idx !== i));
  };

  const handleSave = () => {
    onSave({
      nickname: nickname.trim(),
      bio: bio.trim(),
      links: links.filter((l) => l.trim() !== ""),
    });
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop with unfold animation */}
      <div className="absolute inset-0 bg-black/90 backdrop-blur-lg animate-fadeIn" />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-xl mx-4 animate-scaleIn">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <div className="text-white/40 text-xs tracking-widest uppercase">
              蚀刻面板
            </div>
            <div className="text-white text-lg font-light">
              智子 #{String(sophonIndex + 1).padStart(5, "0")}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-white/40 hover:text-white text-xl cursor-pointer"
          >
            ✕
          </button>
        </div>

        {/* Divider glow */}
        <div className="h-px bg-gradient-to-r from-transparent via-blue-400/40 to-transparent mb-6" />

        {/* Form */}
        <div className="space-y-5">
          {/* Nickname */}
          <div>
            <label className="block text-white/50 text-xs tracking-widest uppercase mb-2">
              名称
            </label>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={20}
              placeholder="给你的智子起个名字"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-400/40 transition-colors"
            />
          </div>

          {/* Bio */}
          <div>
            <label className="block text-white/50 text-xs tracking-widest uppercase mb-2">
              蚀刻内容
            </label>
            <textarea
              value={bio}
              onChange={(e) => setBio(e.target.value)}
              maxLength={500}
              rows={4}
              placeholder="写下你想蚀刻在智子上的文字…"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-3 text-white placeholder:text-white/20 focus:outline-none focus:border-blue-400/40 transition-colors resize-none"
            />
            <div className="text-right text-white/20 text-xs mt-1">
              {bio.length}/500
            </div>
          </div>

          {/* Links */}
          <div>
            <label className="block text-white/50 text-xs tracking-widest uppercase mb-2">
              链接
            </label>
            {links.map((link, i) => (
              <div key={i} className="flex gap-2 mb-2">
                <input
                  type="url"
                  value={link}
                  onChange={(e) => updateLink(i, e.target.value)}
                  placeholder="https://..."
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-blue-400/40 transition-colors"
                />
                {links.length > 1 && (
                  <button
                    onClick={() => removeLink(i)}
                    className="text-white/30 hover:text-red-400 px-2 cursor-pointer"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            {links.length < 5 && (
              <button
                onClick={addLink}
                className="text-blue-300/50 hover:text-blue-300 text-sm cursor-pointer"
              >
                + 添加链接
              </button>
            )}
          </div>
        </div>

        {/* Divider */}
        <div className="h-px bg-gradient-to-r from-transparent via-blue-400/20 to-transparent my-6" />

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 py-3 rounded-lg border border-white/10 text-white/50 hover:text-white hover:border-white/20 transition-all cursor-pointer text-sm"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="flex-1 py-3 rounded-lg bg-blue-500/20 border border-blue-400/30 text-blue-200 hover:bg-blue-500/30 hover:border-blue-400/50 transition-all cursor-pointer text-sm tracking-wide"
          >
            蚀刻保存
          </button>
        </div>
      </div>
    </div>
  );
}
