"use client";
import { useState, useRef, useEffect, useLayoutEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Plus, Search, X, Edit2, Trash2 } from "lucide-react";

interface DropdownOption {
  id: string;
  value: string;
}

interface SearchableDropdownProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[] | DropdownOption[];
  onCreateNew?: (value: string) => Promise<void>;
  onEdit?: (id: string, oldValue: string, newValue: string) => Promise<void>;
  onDelete?: (id: string, value: string) => Promise<void>;
  placeholder?: string;
  required?: boolean;
  error?: string;
  disabled?: boolean;
  className?: string;
}

export function SearchableDropdown({
  label,
  value,
  onChange,
  options,
  onCreateNew,
  onEdit,
  onDelete,
  placeholder = "Select or search...",
  required = false,
  error,
  disabled = false,
  className = "",
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<{ id: string; value: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number; up: boolean }>({ top: 0, left: 0, width: 0, up: false });

  // The menu is portalled to <body> with fixed positioning so cards with
  // overflow-hidden (or scrolling modals) can't clip it.
  const place = useCallback(() => {
    const r = dropdownRef.current?.getBoundingClientRect();
    if (!r) return;
    const spaceBelow = window.innerHeight - r.bottom;
    const up = spaceBelow < 340 && r.top > spaceBelow;
    setPos({ top: up ? r.top - 6 : r.bottom + 6, left: r.left, width: r.width, up });
  }, []);

  useLayoutEffect(() => {
    if (!isOpen) return;
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [isOpen, place]);

  // Normalize options to DropdownOption format
  const normalizedOptions: DropdownOption[] = options.map((opt) => {
    if (typeof opt === "string") {
      return { id: opt, value: opt };
    }
    return opt;
  });

  // Filter options based on search query
  const filteredOptions = normalizedOptions.filter((option) =>
    option.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Check if search query matches any existing option
  const exactMatch = normalizedOptions.some(
    (option) => option.value.toLowerCase() === searchQuery.toLowerCase()
  );

  // Show "Create new" option when user types 2+ characters, no exact match, and onCreateNew is provided
  const showCreateOption =
    searchQuery.trim().length >= 2 && !exactMatch && onCreateNew;

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const t = event.target as Node;
      if (dropdownRef.current && !dropdownRef.current.contains(t) && !menuRef.current?.contains(t)) {
        setIsOpen(false);
        setSearchQuery("");
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  // Focus search input when dropdown opens or edit input when editing
  useEffect(() => {
    if (isOpen && searchInputRef.current && !editingId) {
      searchInputRef.current.focus();
    }
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [isOpen, editingId]);

  const handleSelect = (option: DropdownOption) => {
    onChange(option.value);
    setIsOpen(false);
    setSearchQuery("");
  };

  const handleEditStart = (id: string, currentValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(id);
    setEditValue(currentValue);
  };

  const handleEditSave = async (id: string, oldValue: string) => {
    if (!onEdit || !editValue.trim() || editValue === oldValue) {
      setEditingId(null);
      return;
    }

    try {
      await onEdit(id, oldValue, editValue.trim());
      
      // Update current selection if it was the edited item
      if (value === oldValue) {
        onChange(editValue.trim());
      }
      
      setEditingId(null);
      setEditValue("");
    } catch (error) {
      console.error("Failed to edit option:", error);
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditValue("");
  };

  const handleDeleteClick = (id: string, optionValue: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteConfirm({ id, value: optionValue });
  };

  const handleDeleteConfirm = async () => {
    if (!onDelete || !deleteConfirm) return;

    try {
      await onDelete(deleteConfirm.id, deleteConfirm.value);
      
      // Clear selection if it was the deleted item
      if (value === deleteConfirm.value) {
        onChange("");
      }
      
      setDeleteConfirm(null);
    } catch (error) {
      console.error("Failed to delete option:", error);
    }
  };

  const handleDeleteCancel = () => {
    setDeleteConfirm(null);
  };

  const handleCreateNew = async () => {
    if (!onCreateNew || !searchQuery.trim()) return;

    setIsCreating(true);
    try {
      await onCreateNew(searchQuery.trim());
      onChange(searchQuery.trim());
      setIsOpen(false);
      setSearchQuery("");
    } catch (error) {
      console.error("Failed to create new option:", error);
    } finally {
      setIsCreating(false);
    }
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange("");
  };

  return (
    <div className={`relative ${className}`}>
      <label className="label mb-1.5 flex items-center gap-1">
        {label} {required && <span className="text-rose-500 font-bold">*</span>}
      </label>

      <div ref={dropdownRef} className="relative">
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => !disabled && setIsOpen(!isOpen)}
          disabled={disabled}
          className={`
            input w-full flex items-center justify-between gap-2 text-left
            ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}
            ${error ? "!border-rose-400" : ""}
            ${isOpen ? "!border-blue-500 ring-4 ring-blue-500/15" : ""}
          `}
        >
          <span className={`truncate ${value ? "text-ink dark:text-slate-100" : "text-slate-400 dark:text-slate-500"}`}>
            {value || placeholder}
          </span>
          <div className="flex items-center gap-1">
            {value && !disabled && (
              <X
                size={14}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                onClick={handleClear}
              />
            )}
            <ChevronDown
              size={16}
              className={`transition-transform duration-200 ${isOpen ? "rotate-180 text-blue-500" : "text-slate-400"}`}
            />
          </div>
        </button>

        {/* Dropdown Menu */}
        {isOpen && typeof document !== "undefined" && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[10050] bg-white dark:bg-surface border border-line rounded-xl shadow-2xl shadow-slate-900/15 dark:shadow-black/50 overflow-hidden animate-fade-in"
            style={{
              left: pos.left,
              width: Math.max(pos.width, 240),
              maxWidth: "calc(100vw - 32px)",
              ...(pos.up ? { bottom: window.innerHeight - pos.top } : { top: pos.top }),
            }}
          >
            {/* Search Input */}
            <div className="p-2 border-b border-slate-100 dark:border-white/[0.06]">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search options..."
                  className="input pl-9 pr-3 h-9 text-sm"
                />
              </div>
            </div>

            {/* Options List */}
            <div className="max-h-64 overflow-y-auto p-1.5">
              {/* Existing Options */}
              {filteredOptions.length > 0 ? (
                <div>
                  <p className="px-2.5 pt-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-3">
                    {searchQuery ? "Matching Options" : "Select Option"}
                  </p>
                  {filteredOptions.map((option) => (
                    <div
                      key={option.id}
                      className={`
                        group relative px-2.5 py-2 rounded-lg text-[13px]
                        transition-colors flex items-center justify-between gap-2
                        ${value === option.value
                          ? "bg-gradient-to-r from-blue-600 to-indigo-600 shadow-sm shadow-blue-500/30"
                          : "hover:bg-blue-50 dark:hover:bg-blue-500/10"}
                      `}
                    >
                      {editingId === option.id ? (
                        /* Edit Mode */
                        <div className="flex items-center gap-2 w-full">
                          <input
                            ref={editInputRef}
                            type="text"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                handleEditSave(option.id, option.value);
                              } else if (e.key === "Escape") {
                                handleEditCancel();
                              }
                            }}
                            placeholder="Edit value..."
                            className="input h-8 text-sm flex-1"
                            onClick={(e) => e.stopPropagation()}
                          />
                          <button
                            type="button"
                            onClick={() => handleEditSave(option.id, option.value)}
                            className="text-green-600 hover:text-green-700 dark:text-green-400 px-2 py-1"
                            title="Save"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            onClick={handleEditCancel}
                            className="text-red-600 hover:text-red-700 dark:text-red-400 px-2 py-1"
                            title="Cancel"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        /* View Mode */
                        <>
                          <button
                            type="button"
                            onClick={() => handleSelect(option)}
                            className={`flex-1 text-left truncate ${value === option.value ? "text-white font-semibold" : "text-ink-2 dark:text-slate-200"}`}
                          >
                            {option.value}
                          </button>
                          <div className="flex items-center gap-1">
                            {value === option.value && (
                              <Check size={14} className="text-white" />
                            )}
                            {/* Edit/Delete buttons - shown on hover or always if CRUD is enabled */}
                            {(onEdit || onDelete) && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                {onEdit && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleEditStart(option.id, option.value, e)}
                                    className={`p-1 rounded-md ${value === option.value ? "text-white/90 hover:bg-white/20" : "text-slate-500 hover:text-blue-600 hover:bg-blue-500/10"}`}
                                    title="Edit"
                                  >
                                    <Edit2 size={12} />
                                  </button>
                                )}
                                {onDelete && (
                                  <button
                                    type="button"
                                    onClick={(e) => handleDeleteClick(option.id, option.value, e)}
                                    className={`p-1 rounded-md ${value === option.value ? "text-white/90 hover:bg-white/20" : "text-rose-500 hover:bg-rose-500/10"}`}
                                    title="Delete"
                                  >
                                    <Trash2 size={12} />
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ))}
                </div>
              ) : searchQuery && filteredOptions.length === 0 && !showCreateOption ? (
                <div className="px-3 py-8 text-center text-xs text-slate-500">
                  No options found for &ldquo;{searchQuery}&rdquo;
                </div>
              ) : searchQuery && filteredOptions.length === 0 && searchQuery.trim().length < 2 ? (
                <div className="px-3 py-8 text-center text-xs text-slate-500">
                  Type at least 2 characters to create new option
                </div>
              ) : null}

              {/* Create New Option */}
              {showCreateOption && (
                <div className="pt-1 mt-1 border-t border-slate-100 dark:border-white/[0.06]">
                  <button
                    type="button"
                    onClick={handleCreateNew}
                    disabled={isCreating}
                    className="w-full text-left px-2.5 py-2 rounded-lg text-[13px] hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors flex items-center gap-2 text-blue-600 dark:text-blue-400 font-semibold"
                  >
                    <Plus size={14} />
                    {isCreating ? "Creating..." : `Create "${searchQuery}"`}
                  </button>
                </div>
              )}
            </div>
          </div>,
          document.body,
        )}
      </div>

      {/* Error Message */}
      {error && <p className="text-xs font-medium text-rose-600 dark:text-rose-400 mt-1.5">{error}</p>}

      {/* Delete Confirmation Dialog */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-[10060] flex items-center justify-center p-4 animate-fade-in">
          <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-[2px]" onClick={handleDeleteCancel} />
          <div className="relative bg-white dark:bg-surface border border-line rounded-2xl shadow-2xl max-w-md w-full p-6 pt-7 overflow-hidden">
            <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-rose-500 via-red-500 to-orange-400" />
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-rose-500 to-red-600 text-white shadow-md shadow-rose-500/30 flex items-center justify-center flex-shrink-0">
                <Trash2 size={22} />
              </div>
              <div className="flex-1">
                <h3 className="font-display text-base font-semibold text-ink mb-1.5">
                  Delete {label}?
                </h3>
                <p className="text-sm text-ink-2 mb-5">
                  Are you sure you want to delete &ldquo;<strong>{deleteConfirm.value}</strong>&rdquo;? 
                  This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={handleDeleteCancel}
                    className="btn-ghost flex-1 justify-center py-2.5"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteConfirm}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white rounded-xl font-semibold text-sm shadow-md shadow-rose-500/25 transition-all"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
