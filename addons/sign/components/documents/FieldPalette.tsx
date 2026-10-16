'use client';

import { Pen, User, Calendar, Type, Check, ChevronDown } from 'lucide-react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

interface Signer {
  id: string;
  name: string;
  email: string;
}

interface FieldPaletteProps {
  signers: Signer[];
  selectedSignerId: string | null;
  onSignerChange: (signerId: string | null) => void;
}

interface FieldType {
  type: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'TEXT' | 'CHECKBOX';
  label: string;
  icon: React.ReactNode;
  color: string;
  defaultWidth: number;
  defaultHeight: number;
}

const FIELD_TYPES: FieldType[] = [
  {
    type: 'SIGNATURE',
    label: 'Signature',
    icon: <Pen className="h-4 w-4" />,
    color: 'bg-blue-500',
    defaultWidth: 200,
    defaultHeight: 50,
  },
  {
    type: 'INITIALS',
    label: 'Initials',
    icon: <User className="h-4 w-4" />,
    color: 'bg-purple-500',
    defaultWidth: 80,
    defaultHeight: 30,
  },
  {
    type: 'DATE',
    label: 'Date',
    icon: <Calendar className="h-4 w-4" />,
    color: 'bg-green-500',
    defaultWidth: 120,
    defaultHeight: 30,
  },
  {
    type: 'TEXT',
    label: 'Text',
    icon: <Type className="h-4 w-4" />,
    color: 'bg-yellow-500',
    defaultWidth: 150,
    defaultHeight: 30,
  },
  {
    type: 'CHECKBOX',
    label: 'Checkbox',
    icon: <Check className="h-4 w-4" />,
    color: 'bg-orange-500',
    defaultWidth: 20,
    defaultHeight: 20,
  },
];

export default function FieldPalette({
  signers,
  selectedSignerId,
  onSignerChange,
}: FieldPaletteProps) {
  const handleDragStart = (e: React.DragEvent, fieldType: FieldType) => {
    // Store field data in drag event
    e.dataTransfer.effectAllowed = 'copy';
    const fieldData = JSON.stringify({
      fieldType: fieldType.type,
      defaultWidth: fieldType.defaultWidth,
      defaultHeight: fieldType.defaultHeight,
      assignedToId: selectedSignerId,
    });
    e.dataTransfer.setData('application/json', fieldData);
    e.dataTransfer.setData('text/plain', fieldType.label);
  };

  return (
    <Card className="w-45 h-fit sticky">
      <CardHeader>
        <CardTitle className="text-lg">Field Palette</CardTitle>
        <p className="text-sm text-gray-600">Drag fields onto the document</p>
      </CardHeader>
      <CardContent className="space-y-2">
        {/* Signer Assignment */}
        <div>
          <label className="text-sm font-medium mb-2 block">Assign To:</label>
          <Select
            value={selectedSignerId || '__unassigned__'}
            onValueChange={(v) => onSignerChange(v === '__unassigned__' ? null : v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select signer..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__unassigned__">Unassigned</SelectItem>
              {signers.map((signer) => (
                <SelectItem key={signer.id} value={signer.id}>
                  {signer.name || signer.email}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Draggable Fields */}
        <div className="space-y-2">
          <label className="text-sm font-medium block">Field Types:</label>
          {FIELD_TYPES.map((fieldType) => (
            <div
              key={fieldType.type}
              draggable
              onDragStart={(e) => handleDragStart(e, fieldType)}
              className={`
                flex items-center gap-3 p-3 rounded-lg cursor-move
                border-2 border-dashed border-gray-300
                hover:border-gray-400 hover:bg-gray-50
                transition-all active:scale-95
              `}
            >
              <div className={`${fieldType.color} text-white p-2 rounded`}>
                {fieldType.icon}
              </div>
              <span className="font-medium text-sm">{fieldType.label}</span>
            </div>
          ))}
        </div>

        {/* Instructions */}
        <div className="pt-2 border-t text-xs text-gray-500 space-y-1">
          <p>• Select a signer above</p>
          <p>• Drag a field type onto the PDF</p>
          <p>• Click fields to edit or delete</p>
          <p>• Drag fields to reposition</p>
        </div>
      </CardContent>
    </Card>
  );
}
