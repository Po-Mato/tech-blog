"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import Phaser from "phaser";

type Props = {
  date: string;
  seed: number;
  stagePack: "classic" | "spiral" | "swarm" | "boss";
  difficulty: 1 | 2 | 3 | 4 | 5;
  theme: "neon" | "mono" | "sunset";
  onResult: (r: { cleared: boolean; score: number; timeMs: number }) => void;
  initialBest?: { bestScore: number; bestTimeMs?: number; cleared: boolean } | null;
};

function mulberry32(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n));
}

function palette(theme: Props["theme"]) {
  if (theme === "mono") {
    return {
      bg: 0x07070a,
      player: 0xffffff,
      bullet: 0xb7b7c8,
      orb: 0x89b4fa,
      text: "#e5e7eb",
      sub: "#9ca3af",
    };
  }
  if (theme === "sunset") {
    return {
      bg: 0x120a1d,
      player: 0xffe09a,
      bullet: 0xff5c8a,
      orb: 0x7dd3fc,
      text: "#ffe4e6",
      sub: "#c7d2fe",
    };
  }
  // neon
  return {
    bg: 0x03030a,
    player: 0x7c3aed,
    bullet: 0x22d3ee,
    orb: 0xa3e635,
    text: "#e5e7eb",
    sub: "#9ca3af",
  };
}

class DailyDodgerScene extends Phaser.Scene {
  private rng!: () => number;
  private colors!: ReturnType<typeof palette>;

  private player!: Phaser.GameObjects.Arc;
  private bullets!: Phaser.Physics.Arcade.Group;
  private orbs!: Phaser.Physics.Arcade.Group;

  private score = 0;
  private stage = 1;
  private stageStartMs = 0;
  private startedMs = 0;
  private ended = false;

  private hudScore!: Phaser.GameObjects.Text;
  private hudStage!: Phaser.GameObjects.Text;
  private hudHint!: Phaser.GameObjects.Text;

  private pointerVec = new Phaser.Math.Vector2(0, 0);
  private usingPointer = false;

  private props: Props;

  constructor(props: Props) {
    super("daily-dodger");
    this.props = props;
  }

  create() {
    this.rng = mulberry32(this.props.seed ^ 0x9e3779b9);
    this.colors = palette(this.props.theme);

    const w = this.scale.width;
    const h = this.scale.height;

    this.cameras.main.setBackgroundColor(this.colors.bg);

    // Player
    this.player = this.add.circle(w / 2, h * 0.72, 10, this.colors.player) as Phaser.GameObjects.Arc;
    this.physics.add.existing(this.player);
    const pb = this.player.body as Phaser.Physics.Arcade.Body;
    pb.setCircle(10);
    pb.setCollideWorldBounds(true);

    // Groups
    this.bullets = this.physics.add.group({ allowGravity: false });
    this.orbs = this.physics.add.group({ allowGravity: false });

    // HUD
    this.hudScore = this.add.text(14, 12, "SCORE 0", {
      color: this.colors.text,
      fontSize: "14px",
      fontFamily: "ui-sans-serif, system-ui",
    });
    this.hudStage = this.add.text(14, 32, `STAGE ${this.stage}`, {
      color: this.colors.sub,
      fontSize: "12px",
      fontFamily: "ui-sans-serif, system-ui",
    });
    this.hudHint = this.add.text(14, h - 44, "Drag to move · Survive + collect orbs", {
      color: this.colors.sub,
      fontSize: "12px",
      fontFamily: "ui-sans-serif, system-ui",
    });

    // Collisions
    this.physics.add.overlap(this.player, this.bullets, () => this.gameOver(false), undefined, this);
    this.physics.add.overlap(this.player, this.orbs, (_p, orb) => {
      orb.destroy();
      this.score += 100;
      this.hudScore.setText(`SCORE ${this.score}`);
    });

    // Input
    this.input.on("pointerdown", () => {
      this.usingPointer = true;
      this.hudHint.setText("Drag to move · Avoid bullets");
    });
    this.input.on("pointerup", () => {
      this.usingPointer = false;
    });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      const cx = w / 2;
      const cy = h / 2;
      this.pointerVec.set(p.worldX - cx, p.worldY - cy);
      this.pointerVec.normalize();
    });

    this.startedMs = Date.now();
    this.stageStartMs = Date.now();

    this.startStage(this.stage);
  }

  update(_time: number, _delta: number) {
    if (this.ended) return;

    const w = this.scale.width;
    const h = this.scale.height;

    const pb = this.player.body as Phaser.Physics.Arcade.Body;

    // Movement: keyboard on desktop, pointer drag on mobile
    const cursors = this.input.keyboard?.createCursorKeys();
    let vx = 0;
    let vy = 0;

    if (cursors) {
      vx = (cursors.left?.isDown ? -1 : 0) + (cursors.right?.isDown ? 1 : 0);
      vy = (cursors.up?.isDown ? -1 : 0) + (cursors.down?.isDown ? 1 : 0);
    }

    if (this.usingPointer) {
      // steer toward pointer direction
      vx = this.pointerVec.x;
      vy = this.pointerVec.y;
    }

    const speed = 240 + this.props.difficulty * 20;
    pb.setVelocity(vx * speed, vy * speed);

    // passive score: survival
    this.score += Math.floor(1 + this.props.difficulty / 2);
    this.hudScore.setText(`SCORE ${this.score}`);

    // Clean bullets out of bounds
    this.bullets.children.each((obj: Phaser.GameObjects.GameObject) => {
      const b = obj as Phaser.GameObjects.Ellipse;
      if (b.x < -50 || b.x > w + 50 || b.y < -50 || b.y > h + 50) b.destroy();
      return true; // Phaser's each callback expects boolean | null | void, but let's be safe for TS strictness
    });

    // Stage progression
    const stageDurationMs = 22_000 + this.props.difficulty * 2_000;
    const elapsed = Date.now() - this.stageStartMs;
    if (elapsed > stageDurationMs) {
      this.stage += 1;
      this.hudStage.setText(`STAGE ${this.stage}`);
      this.stageStartMs = Date.now();
      this.startStage(this.stage);

      // Win condition: survive 5 stages
      if (this.stage > 5) {
        this.gameOver(true);
      }
    }

    // Slightly attract player toward lower half (keep play area focused)
    const targetY = h * 0.7;
    const dy = targetY - this.player.y;
    this.player.y += clamp(dy * 0.002, -1.2, 1.2);
  }

  private startStage(stage: number) {
    const w = this.scale.width;
    const h = this.scale.height;

    const diff = this.props.difficulty;
    const pack = this.props.stagePack;

    // Every stage, spawn some collectible orbs
    const orbCount = 3 + Math.floor(diff / 2);
    for (let i = 0; i < orbCount; i++) {
      const ox = 30 + this.rng() * (w - 60);
      const oy = 50 + this.rng() * (h - 140);
      const orb = this.add.circle(ox, oy, 6, this.colors.orb);
      this.orbs.add(orb);
      this.physics.add.existing(orb);
      const ob = orb.body as Phaser.Physics.Arcade.Body;
      ob.setCircle(6);
      ob.setImmovable(true);
    }

    // Bullet patterns
    const baseRate = 280 - diff * 25; // ms
    const rate = Math.max(120, baseRate);
    const burst = 3 + Math.floor(diff / 2) + Math.min(4, stage);

    if (pack === "classic") {
      this.time.addEvent({
        delay: rate,
        repeat: Math.floor(6000 / rate),
        callback: () => {
          for (let i = 0; i < burst; i++) {
            const x = this.rng() * w;
            const y = -10;
            this.spawnBullet(x, y, 0, 1, 190 + diff * 20);
          }
        },
      });
    } else if (pack === "spiral") {
      let angle = this.rng() * Math.PI * 2;
      this.time.addEvent({
        delay: rate,
        repeat: Math.floor(6500 / rate),
        callback: () => {
          angle += 0.22 + diff * 0.02;
          const cx = w / 2;
          const cy = h * 0.25;
          const sp = 210 + diff * 22;
          for (let k = 0; k < 2 + Math.floor(diff / 2); k++) {
            const a = angle + k * (Math.PI / (2 + diff));
            this.spawnBullet(cx, cy, Math.cos(a), Math.sin(a), sp);
          }
        },
      });
    } else if (pack === "swarm") {
      this.time.addEvent({
        delay: Math.max(140, rate - 40),
        repeat: Math.floor(6500 / Math.max(140, rate - 40)),
        callback: () => {
          const lanes = 4 + diff;
          for (let i = 0; i < lanes; i++) {
            const x = (w * (i + 0.5)) / lanes;
            const y = -10;
            const sway = (this.rng() - 0.5) * 0.7;
            this.spawnBullet(x, y, sway, 1, 220 + diff * 22);
          }
        },
      });
    } else {
      // boss-ish: periodic aimed shots
      this.time.addEvent({
        delay: Math.max(150, rate),
        repeat: Math.floor(7000 / Math.max(150, rate)),
        callback: () => {
          const px = this.player.x;
          const py = this.player.y;
          const bx = this.rng() * w;
          const by = -10;
          const dx = px - bx;
          const dy = py - by;
          const len = Math.max(1, Math.hypot(dx, dy));
          this.spawnBullet(bx, by, dx / len, dy / len, 260 + diff * 24);
          if (diff >= 4) {
            // add side shots
            this.spawnBullet(bx, by, (dx / len) + 0.25, (dy / len), 240 + diff * 20);
            this.spawnBullet(bx, by, (dx / len) - 0.25, (dy / len), 240 + diff * 20);
          }
        },
      });
    }
  }

  private spawnBullet(x: number, y: number, nx: number, ny: number, speed: number) {
    const b = this.add.circle(x, y, 5, this.colors.bullet);
    this.bullets.add(b);
    this.physics.add.existing(b);
    const body = b.body as Phaser.Physics.Arcade.Body;
    body.setCircle(5);
    body.setVelocity(nx * speed, ny * speed);
  }

  private gameOver(cleared: boolean) {
    if (this.ended) return;
    this.ended = true;

    const timeMs = Math.max(0, Date.now() - this.startedMs);
    const bonus = cleared ? 5000 : 0;
    const finalScore = this.score + bonus;

    const finish = () => {
      this.props.onResult({ cleared, score: finalScore, timeMs });
    };

    // Overlay
    const w = this.scale.width;
    const h = this.scale.height;

    // Background Dim
    const overlay = this.add.rectangle(w / 2, h / 2, w, h, 0x000000, 0.7);
    overlay.setInteractive(); // Block events to game world

    const box = this.add.rectangle(w / 2, h / 2, Math.min(420, w - 40), 240, 0x000000, 0.8);
    box.setStrokeStyle(2, cleared ? 0xa3e635 : 0xff5c8a, 0.8);

    const title = cleared ? "MISSION CLEAR" : "GAME OVER";
    this.add.text(w / 2, h / 2 - 70, title, {
      color: cleared ? "#a3e635" : "#ff5c8a",
      fontSize: "32px",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 - 10, `Score: ${finalScore.toLocaleString()}`, {
      color: "#ffffff",
      fontSize: "20px",
      fontFamily: "ui-sans-serif, system-ui",
    }).setOrigin(0.5);

    this.add.text(w / 2, h / 2 + 25, `Time: ${(timeMs / 1000).toFixed(1)}s`, {
      color: "#9ca3af",
      fontSize: "14px",
      fontFamily: "ui-sans-serif, system-ui",
    }).setOrigin(0.5);

    const btn = this.add.rectangle(w / 2, h / 2 + 80, 180, 40, 0xffffff, 0.1);
    btn.setStrokeStyle(1, 0xffffff, 0.3);
    btn.setInteractive({ useHandCursor: true });

    const btnText = this.add.text(w / 2, h / 2 + 80, "BACK TO MENU", {
      color: "#ffffff",
      fontSize: "14px",
    }).setOrigin(0.5);

    btn.on("pointerover", () => btn.setFillStyle(0xffffff, 0.2));
    btn.on("pointerout", () => btn.setFillStyle(0xffffff, 0.1));

    // Multiple ways to finish
    const triggerFinish = () => {
      finish();
    };

    btn.on("pointerdown", triggerFinish);

    // Global listeners with delay
    this.time.delayedCall(800, () => {
      this.input.once("pointerdown", () => {
        if (this.ended) finish();
      });
      this.input.keyboard?.once("keydown-SPACE", finish);
      this.input.keyboard?.once("keydown-ENTER", finish);

      this.add.text(w / 2, h / 2 + 115, "(or press Space/Enter)", {
        color: "#6b7280",
        fontSize: "10px",
      }).setOrigin(0.5);
    });
  }
}

export default function DailyDodgerImpl(props: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  const [ready, setReady] = useState(false);

  const colors = useMemo(() => palette(props.theme), [props.theme]);

  useEffect(() => {
    if (!containerRef.current) return;

    const scene = new DailyDodgerScene(props);

    const config: Phaser.Types.Core.GameConfig = {
      type: Phaser.AUTO,
      parent: containerRef.current,
      width: 720,
      height: 520,
      backgroundColor: colors.bg,
      input: {
        keyboard: true,
        mouse: true,
        touch: true,
      },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      physics: {
        default: "arcade",
        arcade: {
          debug: false,
        },
      },
      scene,
    };

    gameRef.current = new Phaser.Game(config);
    setReady(true);

    return () => {
      try {
        gameRef.current?.destroy(true);
      } catch {
        // ignore
      }
      gameRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.date]);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-white/70">
          Template: <span className="text-white">Daily Dodger</span> · Pack:{" "}
          <span className="text-white">{props.stagePack}</span> · Diff:{" "}
          <span className="text-white">{props.difficulty}</span>
        </div>
        <div className="text-xs text-white/50">Seed {props.seed}</div>
      </div>

      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30">
        <div ref={containerRef} />
      </div>

      {!ready ? (
        <div className="mt-3 text-sm text-white/60">로딩 중…</div>
      ) : null}

      <div className="mt-4 text-xs text-white/50">
        모바일: 화면을 누른 채로 드래그해서 이동 · 데스크톱: 방향키
      </div>
    </div>
  );
}
