import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Stage, Layer, Rect, Text as KonvaText, Group } from 'react-konva';
import { useTranslation } from 'react-i18next';
import api from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card } from '@/components/ui/card';
import { Layout } from '@/components/Layout';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Save, Type, QrCode as QrCodeIcon, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

interface BadgeElement {
  id: string;
  type: 'text' | 'qrcode';
  x: number;
  y: number;
  width?: number;
  height?: number;
  text?: string;
  fontSize?: number;
  source?: string; // field name like 'first_name'
}

export default function BadgeTemplateEditor() {
  const { t } = useTranslation();
  const { eventId } = useParams<{ eventId: string }>();
  const navigate = useNavigate();
  const [elements, setElements] = useState<BadgeElement[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [badgeName, setBadgeName] = useState('Badge Template');
  const [badgeWidth, setBadgeWidth] = useState(300); // 80mm * 3.78 pixels/mm ≈ 300px
  const [badgeHeight, setBadgeHeight] = useState(189); // 50mm * 3.78 pixels/mm ≈ 189px
  const [eventName, setEventName] = useState<string>('');
  const [fieldSchema, setFieldSchema] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  const stageRef = useRef(null);

  useEffect(() => {
    if (eventId) {
      loadEventAndTemplate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load when eventId changes
  }, [eventId]);

  const loadEventAndTemplate = async () => {
    try {
      const eventRes = await api.get(`/api/events/${eventId}`);
      setEventName(eventRes.data.name);
      setBadgeName(`${eventRes.data.name} Badge`);
      
      // Load field schema
      if (eventRes.data.field_schema && eventRes.data.field_schema.length > 0) {
        setFieldSchema(eventRes.data.field_schema);
      } else {
        // Default fields if no schema
        setFieldSchema(['code', 'first_name', 'last_name', 'email', 'company', 'position']);
      }
      
      // Load existing template for this event if exists
      if (eventRes.data.custom_fields && eventRes.data.custom_fields.badgeTemplate) {
        const template = eventRes.data.custom_fields.badgeTemplate;
        if (template.elements) {
          setElements(template.elements);
        }
        if (template.width_mm) {
          setBadgeWidth(template.width_mm * 3.78);
        }
        if (template.height_mm) {
          setBadgeHeight(template.height_mm * 3.78);
        }
      }
    } catch (error) {
      console.error('Failed to load event', error);
    }
  };

  const addTextField = () => {
    const newElement: BadgeElement = {
      id: `text-${Date.now()}`,
      type: 'text',
      x: 50,
      y: 50,
      text: 'Sample Text',
      fontSize: 20,
      source: 'first_name',
    };
    setElements([...elements, newElement]);
  };

  const addQRCode = () => {
    const newElement: BadgeElement = {
      id: `qr-${Date.now()}`,
      type: 'qrcode',
      x: 200,
      y: 50,
      width: 80,
      height: 80,
      source: 'code',
    };
    setElements([...elements, newElement]);
  };

  const handleDragEnd = (e: { target: { x(): number; y(): number } }, id: string) => {
    setElements(elements.map(el =>
      el.id === id ? { ...el, x: e.target.x(), y: e.target.y() } : el
    ));
  };

  const handleSave = async () => {
    if (!eventId) {
      alert(t('pleaseSelectEvent'));
      return;
    }

    setIsSaving(true);
    try {
      const template = {
        name: badgeName,
        width_mm: Math.round(badgeWidth / 3.78),
        height_mm: Math.round(badgeHeight / 3.78),
        json_schema: {
          elements: elements,
        },
      };
      
      // TODO: Create backend endpoint for saving templates
      console.log('Template to save:', JSON.stringify(template, null, 2));
      alert(t('templateSaved'));
      
      // Navigate back to event details
      if (eventId) {
        navigate(`/events/${eventId}`);
      }
    } catch (error) {
      console.error('Failed to save template', error);
      alert(t('templateSaveFailed'));
    } finally {
      setIsSaving(false);
    }
  };

  const selectedElement = elements.find(el => el.id === selectedId);

  return (
    <Layout>
      <div className="container mx-auto px-4 py-8">
        {eventId && (
          <div className="mb-6">
            <Button variant="ghost" asChild className="pl-0">
              <Link to={`/events/${eventId}`}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {t('backToEvent')}
              </Link>
            </Button>
          </div>
        )}
        <div className="mb-6">
          <h1 className="text-3xl font-bold mb-2">
            {t('badgeTemplateEditor')}
            {eventName && <span className="text-muted-foreground ml-2">- {eventName}</span>}
          </h1>
          <p className="text-muted-foreground">
            {t('badgeTemplateEditorDesc')}
          </p>
        </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Toolbar */}
        <Card className="p-4 lg:col-span-1">
          <div className="space-y-4">
            <div>
              <Label>Template Name</Label>
              <Input
                value={badgeName}
                onChange={(e) => setBadgeName(e.target.value)}
                placeholder="e.g., Conference Badge 80x50mm"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Width (px)</Label>
                <Input
                  type="number"
                  value={badgeWidth}
                  onChange={(e) => setBadgeWidth(Number(e.target.value))}
                />
              </div>
              <div>
                <Label>Height (px)</Label>
                <Input
                  type="number"
                  value={badgeHeight}
                  onChange={(e) => setBadgeHeight(Number(e.target.value))}
                />
              </div>
            </div>

            <div className="border-t pt-4">
              <Label className="mb-2 block">Add Elements</Label>
              <div className="space-y-2">
                <Button onClick={addTextField} className="w-full" variant="outline">
                  <Type className="mr-2 h-4 w-4" /> Add Text Field
                </Button>
                <Button onClick={addQRCode} className="w-full" variant="outline">
                  <QrCodeIcon className="mr-2 h-4 w-4" /> Add QR Code
                </Button>
              </div>
            </div>

            {selectedElement && (
              <div className="border-t pt-4">
                <Label className="mb-2 block">Selected Element</Label>
                <div className="space-y-2">
                  <div>
                    <Label className="text-xs">X: {selectedElement.x.toFixed(0)}</Label>
                  </div>
                  <div>
                    <Label className="text-xs">Y: {selectedElement.y.toFixed(0)}</Label>
                  </div>
                  {selectedElement.type === 'text' && (
                    <>
                      <div>
                        <Label className="text-xs">Text</Label>
                        <Input
                          value={selectedElement.text}
                          onChange={(e) => {
                            setElements(elements.map(el =>
                              el.id === selectedId ? { ...el, text: e.target.value } : el
                            ));
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Font Size</Label>
                        <Input
                          type="number"
                          value={selectedElement.fontSize}
                          onChange={(e) => {
                            setElements(elements.map(el =>
                              el.id === selectedId ? { ...el, fontSize: Number(e.target.value) } : el
                            ));
                          }}
                        />
                      </div>
                      <div>
                        <Label className="text-xs">Data Source</Label>
                        <Select
                          value={selectedElement.source}
                          onValueChange={(value: string) => {
                            setElements(elements.map(el =>
                              el.id === selectedId ? { ...el, source: value } : el
                            ));
                          }}
                        >
                          <SelectTrigger>
                            <SelectValue placeholder={t('selectField')} />
                          </SelectTrigger>
                          <SelectContent>
                            {fieldSchema.map((field) => (
                              <SelectItem key={field} value={field}>
                                {field}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            <Button onClick={handleSave} className="w-full" disabled={isSaving}>
              <Save className="mr-2 h-4 w-4" /> {isSaving ? t('saving') : t('saveTemplate')}
            </Button>
          </div>
        </Card>

        {/* Canvas */}
        <Card className="p-4 lg:col-span-2">
          <Label className="mb-2 block">Preview</Label>
          <div className="border rounded-md bg-white" style={{ width: '100%', overflow: 'auto' }}>
            <Stage
              width={badgeWidth}
              height={badgeHeight}
              ref={stageRef}
              onClick={(e) => {
                if (e.target === e.target.getStage()) {
                  setSelectedId(null);
                }
              }}
            >
              <Layer>
                {/* Background */}
                <Rect
                  x={0}
                  y={0}
                  width={badgeWidth}
                  height={badgeHeight}
                  fill="#ffffff"
                  stroke="#cccccc"
                  strokeWidth={2}
                />

                {/* Elements */}
                {elements.map((element) => (
                  <Group
                    key={element.id}
                    draggable
                    x={element.x}
                    y={element.y}
                    onDragEnd={(e) => handleDragEnd(e, element.id)}
                    onClick={() => setSelectedId(element.id)}
                  >
                    {element.type === 'text' && (
                      <KonvaText
                        text={element.text}
                        fontSize={element.fontSize}
                        fill={selectedId === element.id ? '#0066cc' : '#000000'}
                        fontStyle={selectedId === element.id ? 'bold' : 'normal'}
                      />
                    )}
                    {element.type === 'qrcode' && (
                      <Rect
                        width={element.width}
                        height={element.height}
                        fill={selectedId === element.id ? '#e6f2ff' : '#f0f0f0'}
                        stroke={selectedId === element.id ? '#0066cc' : '#666666'}
                        strokeWidth={2}
                        cornerRadius={4}
                      />
                    )}
                  </Group>
                ))}
              </Layer>
            </Stage>
          </div>
          <p className="text-xs text-muted-foreground mt-2">
            Drag elements to reposition. Click to select and edit properties.
          </p>
        </Card>
      </div>
      </div>
    </Layout>
  );
}

