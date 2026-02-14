"use client";

import { useState } from "react";

interface Player {
  playerId: string;
  playerName: string;
  position: string;
  value: number;
}

interface Team {
  id: string;
  name: string;
  roster: Player[];
}

interface TradeCalculatorProps {
  teams: Team[];
}

export function TradeCalculator({ teams }: TradeCalculatorProps) {
  const [team1Id, setTeam1Id] = useState<string>("");
  const [team2Id, setTeam2Id] = useState<string>("");
  const [team1Players, setTeam1Players] = useState<Player[]>([]);
  const [team2Players, setTeam2Players] = useState<Player[]>([]);

  const team1 = teams.find((t) => t.id === team1Id);
  const team2 = teams.find((t) => t.id === team2Id);

  const team1Value = team1Players.reduce((sum, p) => sum + p.value, 0);
  const team2Value = team2Players.reduce((sum, p) => sum + p.value, 0);
  const valueDiff = team1Value - team2Value;

  const addPlayer = (side: 1 | 2, player: Player) => {
    if (side === 1) {
      if (!team1Players.find((p) => p.playerId === player.playerId)) {
        setTeam1Players([...team1Players, player]);
      }
    } else {
      if (!team2Players.find((p) => p.playerId === player.playerId)) {
        setTeam2Players([...team2Players, player]);
      }
    }
  };

  const removePlayer = (side: 1 | 2, playerId: string) => {
    if (side === 1) {
      setTeam1Players(team1Players.filter((p) => p.playerId !== playerId));
    } else {
      setTeam2Players(team2Players.filter((p) => p.playerId !== playerId));
    }
  };

  const clearTrade = () => {
    setTeam1Players([]);
    setTeam2Players([]);
  };

  return (
    <div className="space-y-8">
      {/* Team Selection */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Team 1
          </label>
          <select
            value={team1Id}
            onChange={(e) => {
              setTeam1Id(e.target.value);
              setTeam1Players([]);
            }}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a team...</option>
            {teams
              .filter((t) => t.id !== team2Id)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-300 mb-2">
            Team 2
          </label>
          <select
            value={team2Id}
            onChange={(e) => {
              setTeam2Id(e.target.value);
              setTeam2Players([]);
            }}
            className="w-full rounded-lg bg-slate-800 border border-slate-700 px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a team...</option>
            {teams
              .filter((t) => t.id !== team1Id)
              .map((team) => (
                <option key={team.id} value={team.id}>
                  {team.name}
                </option>
              ))}
          </select>
        </div>
      </div>

      {/* Trade Sides */}
      {team1 && team2 && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Team 1 Side */}
            <TradeSide
              team={team1}
              selectedPlayers={team1Players}
              onAddPlayer={(p) => addPlayer(1, p)}
              onRemovePlayer={(id) => removePlayer(1, id)}
              totalValue={team1Value}
            />

            {/* Team 2 Side */}
            <TradeSide
              team={team2}
              selectedPlayers={team2Players}
              onAddPlayer={(p) => addPlayer(2, p)}
              onRemovePlayer={(id) => removePlayer(2, id)}
              totalValue={team2Value}
            />
          </div>

          {/* Trade Analysis */}
          {(team1Players.length > 0 || team2Players.length > 0) && (
            <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-white">
                  Trade Analysis
                </h3>
                <button
                  onClick={clearTrade}
                  className="text-sm text-slate-400 hover:text-white transition-colors"
                >
                  Clear Trade
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 text-center">
                <div>
                  <div className="text-sm text-slate-400 mb-1">{team1.name}</div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {team1Value.toFixed(1)}
                  </div>
                </div>
                <div className="flex items-center justify-center">
                  <div
                    className={`px-4 py-2 rounded-lg font-mono font-bold ${
                      Math.abs(valueDiff) < 10
                        ? "bg-green-500/20 text-green-400"
                        : Math.abs(valueDiff) < 25
                          ? "bg-yellow-500/20 text-yellow-400"
                          : "bg-red-500/20 text-red-400"
                    }`}
                  >
                    {valueDiff > 0 ? "+" : ""}
                    {valueDiff.toFixed(1)}
                  </div>
                </div>
                <div>
                  <div className="text-sm text-slate-400 mb-1">{team2.name}</div>
                  <div className="text-2xl font-bold text-white font-mono">
                    {team2Value.toFixed(1)}
                  </div>
                </div>
              </div>

              <div className="mt-4 pt-4 border-t border-slate-700">
                <div className="text-center">
                  {Math.abs(valueDiff) < 10 ? (
                    <span className="text-green-400">
                      This trade is fairly balanced
                    </span>
                  ) : Math.abs(valueDiff) < 25 ? (
                    <span className="text-yellow-400">
                      {valueDiff > 0 ? team1.name : team2.name} slightly wins
                      this trade
                    </span>
                  ) : (
                    <span className="text-red-400">
                      {valueDiff > 0 ? team1.name : team2.name} clearly wins
                      this trade
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function TradeSide({
  team,
  selectedPlayers,
  onAddPlayer,
  onRemovePlayer,
  totalValue,
}: {
  team: Team;
  selectedPlayers: Player[];
  onAddPlayer: (player: Player) => void;
  onRemovePlayer: (playerId: string) => void;
  totalValue: number;
}) {
  const [search, setSearch] = useState("");

  const availablePlayers = team.roster.filter(
    (p) =>
      !selectedPlayers.find((sp) => sp.playerId === p.playerId) &&
      (search === "" ||
        p.playerName.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <div className="bg-slate-800/50 rounded-xl ring-1 ring-slate-700 p-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-semibold text-white">{team.name} receives</h3>
        <div className="text-sm font-mono text-green-400">
          {totalValue.toFixed(1)}
        </div>
      </div>

      {/* Selected Players */}
      <div className="space-y-2 mb-4 min-h-[60px]">
        {selectedPlayers.length === 0 ? (
          <div className="text-slate-500 text-sm py-4 text-center">
            Add players below
          </div>
        ) : (
          selectedPlayers.map((player) => (
            <div
              key={player.playerId}
              className="flex items-center justify-between bg-slate-900/50 rounded-lg px-3 py-2"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400">
                  {player.position}
                </span>
                <span className="text-white">{player.playerName}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-green-400">
                  {player.value.toFixed(1)}
                </span>
                <button
                  onClick={() => onRemovePlayer(player.playerId)}
                  className="text-slate-400 hover:text-red-400 transition-colors"
                >
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Player Search */}
      <div className="border-t border-slate-700 pt-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search players..."
          className="w-full rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-2"
        />
        <div className="max-h-48 overflow-y-auto space-y-1">
          {availablePlayers.slice(0, 20).map((player) => (
            <button
              key={player.playerId}
              onClick={() => onAddPlayer(player)}
              className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-slate-700/50 transition-colors text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-slate-400 w-6">
                  {player.position}
                </span>
                <span className="text-slate-300">{player.playerName}</span>
              </div>
              <span className="text-xs font-mono text-slate-400">
                {player.value.toFixed(1)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
