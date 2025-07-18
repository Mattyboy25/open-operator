"use client";

import React from "react";

const AnimatedGrid = () => {
  return (
    <svg
      className="animated-grid"
      viewBox="0 0 392 258"
      preserveAspectRatio="none"
    >
      <defs>
        <filter id="glow">
          <feGaussianBlur stdDeviation="4" result="coloredBlur"/>
          <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <filter id="strongGlow">
          <feGaussianBlur stdDeviation="6" result="coloredBlur"/>
          <feMerge> 
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
        <linearGradient id="pulseGradient" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="rgba(47, 193, 76, 0)" />
          <stop offset="15%" stopColor="rgba(47, 193, 76, 0.3)" />
          <stop offset="30%" stopColor="rgba(47, 193, 76, 0.6)" />
          <stop offset="50%" stopColor="rgba(47, 193, 76, 0.9)" />
          <stop offset="70%" stopColor="rgba(47, 193, 76, 1)" />
          <stop offset="85%" stopColor="rgba(47, 193, 76, 1)" />
          <stop offset="100%" stopColor="rgba(47, 193, 76, 0.8)" />
        </linearGradient>
        <linearGradient id="verticalPulseGradient" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="rgba(47, 193, 76, 0)" />
          <stop offset="15%" stopColor="rgba(47, 193, 76, 0.3)" />
          <stop offset="30%" stopColor="rgba(47, 193, 76, 0.6)" />
          <stop offset="50%" stopColor="rgba(47, 193, 76, 0.9)" />
          <stop offset="70%" stopColor="rgba(47, 193, 76, 1)" />
          <stop offset="85%" stopColor="rgba(47, 193, 76, 1)" />
          <stop offset="100%" stopColor="rgba(47, 193, 76, 0.8)" />
        </linearGradient>
        <linearGradient id="shimmerGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="rgba(47, 193, 76, 0)" />
          <stop offset="30%" stopColor="rgba(47, 193, 76, 0)" />
          <stop offset="45%" stopColor="rgba(47, 193, 76, 0.2)" />
          <stop offset="50%" stopColor="rgba(255, 255, 255, 0.8)" />
          <stop offset="55%" stopColor="rgba(47, 193, 76, 0.2)" />
          <stop offset="70%" stopColor="rgba(47, 193, 76, 0)" />
          <stop offset="100%" stopColor="rgba(47, 193, 76, 0)" />
          <animateTransform
            attributeName="gradientTransform"
            type="translate"
            values="-150,-150;600,600;-150,-150"
            dur="3s"
            repeatCount="indefinite"
          />
        </linearGradient>
      </defs>
      
      <g className="grid-lines">
        {/* Horizontal lines with shimmer */}
        {[...Array(16)].map((_, i) => (
          <line
            key={`h-${i}`}
            className="grid-line grid-line-shimmer"
            x2="392"
            y1={`${15.5 + i * 16}`}
            y2={`${15.5 + i * 16}`}
            stroke="url(#shimmerGradient)"
            style={{
              animationDelay: `${i * 0.1}s`
            }}
          />
        ))}

        {/* Vertical lines with shimmer */}
        {[...Array(33)].map((_, i) => (
          <line
            key={`v-${i}`}
            className="grid-line grid-line-shimmer"
            x1={`${12 + i * 16}`}
            x2={`${12 + i * 16}`}
            y1="0"
            y2="256"
            stroke="url(#shimmerGradient)"
            style={{
              animationDelay: `${i * 0.05}s`
            }}
          />
        ))}

        {/* Circuit-like directional pulses */}
        <g className="pulse-group">
          {/* Circuit path 1: Right, down, right - 2 turns */}
          <path
            className="circuit-pulse circuit-1"
            d="M 0 47.5 L 76 47.5 L 76 127.5 L 140 127.5 L 140 258"
            fill="none"
            stroke="url(#pulseGradient)"
            filter="url(#strongGlow)"
          />

          {/* Circuit path 2: Down, right, down - 2 turns */}
          <path
            className="circuit-pulse circuit-2"
            d="M 220 0 L 220 63.5 L 300 63.5 L 300 111.5 L 392 111.5"
            fill="none"
            stroke="url(#pulseGradient)"
            filter="url(#strongGlow)"
          />

          {/* Circuit path 6: Down, left, up, right - 3 turns */}
          <path
            className="circuit-pulse circuit-3"
            d="M 316 0 L 316 79.5 L 188 79.5 L 188 143.5 L 252 143.5 L 252 258"
            fill="none"
            stroke="url(#pulseGradient)"
            filter="url(#strongGlow)"
          />

          {/* Circuit path 8: Up, left, down, right - 3 turns */}
          <path
            className="circuit-pulse circuit-4"
            d="M 364 258 L 364 175.5 L 284 175.5 L 284 95.5 L 188 95.5 L 188 31.5 L 392 31.5"
            fill="none"
            stroke="url(#verticalPulseGradient)"
            filter="url(#strongGlow)"
          />
          {/* Circuit path 9: New path, avoids all others */}
          <path
            className="circuit-pulse circuit-5"
            d="M 40 0 L 40 60 L 100 60 L 100 200 L 180 200 L 180 258"
            fill="none"
            stroke="url(#pulseGradient)"
            filter="url(#strongGlow)"
          />
        </g>
      </g>
    </svg>
  );
};

export default AnimatedGrid;
