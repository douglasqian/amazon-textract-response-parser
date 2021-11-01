/**
 * TRP classes for standard document/OCR results (e.g. DetectText and AnalyzeDocument)
 */

// Local Dependencies:
import {
  ApiBlock,
  ApiBlockType,
  ApiCellBlock,
  ApiKeyValueEntityType,
  ApiKeyValueSetBlock,
  ApiLineBlock,
  ApiPageBlock,
  ApiRelationshipType,
  ApiSelectionElementBlock,
  ApiSelectionStatus,
  ApiTableBlock,
  ApiTextType,
  ApiWordBlock,
} from "./api-models/document";
import {
  ApiDocumentMetadata,
  ApiResponsePage,
  ApiResponsePages,
  ApiResponseWithContent,
  ApiResultWarning,
} from "./api-models/response";
import { ApiObjectWrapper, getIterable, modalAvg } from "./base";
import { BoundingBox, Geometry } from "./geometry";

export class ApiBlockWrapper<T extends ApiBlock> extends ApiObjectWrapper<T> {
  get id(): string {
    return this._dict.Id;
  }

  get blockType(): ApiBlockType {
    return this._dict.BlockType;
  }
}

// Simple constructor type for TS mixin pattern
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Constructor<T> = new (...args: any[]) => T;

export class Word extends ApiBlockWrapper<ApiWordBlock> {
  _geometry: Geometry<ApiWordBlock, Word>;

  constructor(block: ApiWordBlock) {
    super(block);
    this._geometry = new Geometry(block.Geometry, this);
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  set confidence(newVal: number) {
    this._dict.Confidence = newVal;
  }
  get geometry(): Geometry<ApiWordBlock, Word> {
    return this._geometry;
  }
  get text(): string {
    return this._dict.Text;
  }
  get textType(): ApiTextType {
    return this._dict.TextType;
  }
  set textType(newVal: ApiTextType) {
    this._dict.TextType = newVal;
  }

  str(): string {
    return this.text;
  }
}

// eslint-disable-next-line @typescript-eslint/ban-types
function WithWords<T extends Constructor<{}>>(SuperClass: T) {
  return class extends SuperClass {
    _words: Word[];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    constructor(...args: any[]) {
      super(...args);
      this._words = [];
    }

    get nWords(): number {
      return this._words.length;
    }

    /**
     * Iterate through the Words in this object
     * @example
     * for (const word of line.iterWords) {
     *   console.log(word.text);
     * }
     * @example
     * [...line.iterWords()].forEach(
     *   (word) => console.log(word.text)
     * );
     */
    iterWords(): Iterable<Word> {
      return getIterable(() => this._words);
    }

    listWords(): Word[] {
      return this._words.slice();
    }

    /**
     * Get a particular Word from the object by index
     * @param ix 0-based index in the word list
     * @throws if the index is out of bounds
     */
    wordAtIndex(ix: number): Word {
      if (ix < 0 || ix >= this._words.length) {
        throw new Error(`Word index ${ix} must be >=0 and <${this._words.length}`);
      }
      return this._words[ix];
    }
  };
}

export class Line extends WithWords(ApiBlockWrapper)<ApiLineBlock> {
  _geometry: Geometry<ApiLineBlock, Line>;
  _parentPage: Page;

  constructor(block: ApiLineBlock, parentPage: Page) {
    super(block);
    this._parentPage = parentPage;
    this._words = [];
    this._geometry = new Geometry(block.Geometry, this);
    const parentDocument = parentPage.parentDocument;
    if (block.Relationships) {
      block.Relationships.forEach((rs) => {
        if (rs.Type == ApiRelationshipType.Child) {
          rs.Ids.forEach((cid) => {
            const wordBlock = parentDocument.getBlockById(cid);
            if (!wordBlock) {
              console.warn(`Document missing word block ${cid} referenced by line ${this.id}`);
              return;
            }
            if (wordBlock.BlockType == ApiBlockType.Word)
              this._words.push(new Word(wordBlock as ApiWordBlock));
          });
        }
      });
    }
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  set confidence(newVal: number) {
    this._dict.Confidence = newVal;
  }
  get geometry(): Geometry<ApiLineBlock, Line> {
    return this._geometry;
  }
  get parentPage(): Page {
    return this._parentPage;
  }
  get text(): string {
    return this._dict.Text;
  }

  str(): string {
    return `Line\n==========\n${this._dict.Text}\nWords\n----------\n${this._words
      .map((word) => `[${word.str()}]`)
      .join("")}`;
  }
}

export class SelectionElement extends ApiBlockWrapper<ApiSelectionElementBlock> {
  _geometry: Geometry<ApiSelectionElementBlock, SelectionElement>;

  constructor(block: ApiSelectionElementBlock) {
    super(block);
    this._geometry = new Geometry(block.Geometry, this);
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  set confidence(newVal: number) {
    this._dict.Confidence = newVal;
  }
  get geometry(): Geometry<ApiSelectionElementBlock, SelectionElement> {
    return this._geometry;
  }
  get selectionStatus(): ApiSelectionStatus {
    return this._dict.SelectionStatus;
  }
  set selectionStatus(newVal: ApiSelectionStatus) {
    this._dict.SelectionStatus = newVal;
  }
}

export class FieldKey extends WithWords(ApiBlockWrapper)<ApiKeyValueSetBlock> {
  _geometry: Geometry<ApiKeyValueSetBlock, FieldKey>;
  _parentField: Field;

  constructor(block: ApiKeyValueSetBlock, parentField: Field) {
    super(block);
    this._parentField = parentField;
    this._words = [];
    this._geometry = new Geometry(block.Geometry, this);

    let childIds: string[] = [];
    (block.Relationships || []).forEach((rs) => {
      if (rs.Type == ApiRelationshipType.Child) {
        childIds = childIds.concat(rs.Ids);
      }
    });

    const parentDocument = parentField.parentForm.parentPage.parentDocument;
    childIds
      .map((id) => {
        const block = parentDocument.getBlockById(id);
        if (!block) {
          console.warn(`Document missing child block ${id} referenced by field key ${this.id}`);
        }
        return block;
      })
      .forEach((block) => {
        if (!block) return; // Already logged warning above
        if (block.BlockType == ApiBlockType.Word) {
          this._words.push(new Word(block));
        }
      });
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  get geometry(): Geometry<ApiKeyValueSetBlock, FieldKey> {
    return this._geometry;
  }
  get parentField(): Field {
    return this._parentField;
  }
  get text(): string {
    return this._words.map((w) => w.text).join(" ");
  }

  str(): string {
    return this.text;
  }
}

export class FieldValue extends ApiBlockWrapper<ApiKeyValueSetBlock> {
  _content: Array<SelectionElement | Word>;
  _geometry: Geometry<ApiKeyValueSetBlock, FieldValue>;
  _parentField: Field;

  constructor(valueBlock: ApiKeyValueSetBlock, parentField: Field) {
    super(valueBlock);
    this._content = [];
    this._parentField = parentField;
    this._geometry = new Geometry(valueBlock.Geometry, this);

    let childIds: string[] = [];
    (valueBlock.Relationships || []).forEach((rs) => {
      if (rs.Type == ApiRelationshipType.Child) {
        childIds = childIds.concat(rs.Ids);
      }
    });

    const parentDocument = parentField.parentForm.parentPage.parentDocument;
    childIds
      .map((id) => {
        const block = parentDocument.getBlockById(id);
        if (!block) {
          console.warn(`Document missing child block ${id} referenced by field value ${this.id}`);
        }
        return block;
      })
      .forEach((block) => {
        if (!block) return; // Already logged warning above
        if (block.BlockType == ApiBlockType.Word) {
          this._content.push(new Word(block));
        } else if (block.BlockType == ApiBlockType.SelectionElement) {
          this._content.push(new SelectionElement(block));
        }
      });
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  get geometry(): Geometry<ApiKeyValueSetBlock, FieldValue> {
    return this._geometry;
  }
  get parentField(): Field {
    return this._parentField;
  }
  get text(): string {
    return this._content.map((c) => ("selectionStatus" in c ? c.selectionStatus : c.text)).join(" ");
  }

  listContent(): Array<SelectionElement | Word> {
    return this._content.slice();
  }
  str(): string {
    return this.text;
  }
}

export class Field {
  _key: FieldKey;
  _parentForm: Form;
  _value: FieldValue | null;

  constructor(keyBlock: ApiKeyValueSetBlock, parentForm: Form) {
    this._parentForm = parentForm;
    this._value = null;

    this._key = new FieldKey(keyBlock, this);

    let valueBlockIds: string[] = [];
    (keyBlock.Relationships || []).forEach((rs) => {
      if (rs.Type == ApiRelationshipType.Value) {
        valueBlockIds = valueBlockIds.concat(rs.Ids);
      }
    });

    if (valueBlockIds.length > 1) {
      const fieldLogName = this._key ? `field '${this._key.text}'` : "unnamed form field";
      console.warn(
        `Got ${valueBlockIds.length} value blocks for ${fieldLogName} (Expected 0-1). Including first only.`
      );
    }
    if (valueBlockIds.length) {
      const parentDocument = parentForm.parentPage.parentDocument;
      const valBlockId = valueBlockIds[0];
      const valBlock = parentDocument.getBlockById(valBlockId);
      if (!valBlock) {
        console.warn(
          `Document missing child block ${valBlockId} referenced by value for field key ${this.key.id}`
        );
      } else {
        this._value = new FieldValue(valBlock as ApiKeyValueSetBlock, this);
      }
    }
  }

  /**
   * Return average confidence over whichever of {key, value} are present.
   */
  get confidence(): number {
    const scores = [];
    if (this._key) {
      scores.push(this._key.confidence || 0);
    }
    if (this._value) {
      scores.push(this._value.confidence || 0);
    }
    if (scores.length) {
      return scores.reduce((acc, next) => acc + next, 0) / scores.length;
    } else {
      return 0;
    }
  }
  get key(): FieldKey {
    return this._key;
  }
  get parentForm(): Form {
    return this._parentForm;
  }
  get value(): FieldValue | null {
    return this._value;
  }

  str(): string {
    return `\nField\n==========\nKey: ${this._key ? this._key.str() : ""}\nValue: ${
      this._value ? this._value.str() : ""
    }`;
  }
}

export class Form {
  _fields: Field[];
  _fieldsMap: { [keyText: string]: Field };
  _parentPage: Page;

  constructor(keyBlocks: ApiKeyValueSetBlock[], parentPage: Page) {
    this._fields = [];
    this._fieldsMap = {};
    this._parentPage = parentPage;

    keyBlocks.forEach((keyBlock) => {
      const f = new Field(keyBlock, this);
      this._fields.push(f);
      const fieldKeyText = f.key.text || "";
      if (fieldKeyText) {
        if (fieldKeyText in this._fieldsMap) {
          if (f.confidence > this._fieldsMap[fieldKeyText].confidence) {
            this._fieldsMap[fieldKeyText] = f;
          }
        } else {
          this._fieldsMap[fieldKeyText] = f;
        }
      }
    });
  }

  get nFields(): number {
    return this._fields.length;
  }
  get parentPage(): Page {
    return this._parentPage;
  }

  getFieldByKey(key: string): Field | null {
    return this._fieldsMap[key] || null;
  }

  /**
   * Iterate through the Fields in the Form.
   * @param skipFieldsWithoutKey Set `true` to skip fields with no field.key (Included by default)
   * @example
   * for (const field of form.iterFields()) {
   *   console.log(field?.key.text);
   * }
   * @example
   * const fields = [...form.iterFields()];
   */
  iterFields(skipFieldsWithoutKey = false): Iterable<Field> {
    return getIterable(() => this.listFields(skipFieldsWithoutKey));
  }

  /**
   * List the Fields in the Form.
   * @param skipFieldsWithoutKey Set `true` to skip fields with no field.key (Included by default)
   */
  listFields(skipFieldsWithoutKey = false): Field[] {
    return skipFieldsWithoutKey ? this._fields.filter((f) => f.key) : this._fields.slice();
  }

  /**
   * List the Fields in the Form with key text containing (case-insensitive) `key`
   * @param key The text to search for in field keys
   */
  searchFieldsByKey(key: string): Field[] {
    const searchKey = key.toLowerCase();
    return this._fields.filter((field) => field.key && field.key.text.toLowerCase().indexOf(searchKey) >= 0);
  }

  str(): string {
    return this._fields.map((f) => f.str()).join("\n");
  }
}

export class Cell extends ApiBlockWrapper<ApiCellBlock> {
  _geometry: Geometry<ApiCellBlock, Cell>;
  _content: Array<SelectionElement | Word>;
  _parentTable: Table;
  _text: string;

  constructor(block: ApiCellBlock, parentTable: Table) {
    super(block);
    const parentDocument = parentTable.parentPage.parentDocument;
    this._geometry = new Geometry(block.Geometry, this);
    this._content = [];
    this._parentTable = parentTable;
    this._text = "";
    (block.Relationships || []).forEach((rs) => {
      if (rs.Type == ApiRelationshipType.Child) {
        rs.Ids.forEach((cid) => {
          const childBlock = parentDocument.getBlockById(cid);
          if (!childBlock) {
            console.warn(`Document missing child block ${cid} referenced by table cell ${this.id}`);
            return;
          }
          const blockType = childBlock.BlockType;
          if (blockType == ApiBlockType.Word) {
            const w = new Word(childBlock as ApiWordBlock);
            this._content.push(w);
            this._text += w.text + " ";
          } else if (blockType == ApiBlockType.SelectionElement) {
            const se = new SelectionElement(childBlock as ApiSelectionElementBlock);
            this._content.push(se);
            this._text += se.selectionStatus + ", ";
          }
        });
      }
    });
  }

  get columnIndex(): number {
    return this._dict.ColumnIndex;
  }
  get columnSpan(): number {
    return this._dict.ColumnSpan || 1;
  }
  get confidence(): number {
    return this._dict.Confidence;
  }
  set confidence(newVal: number) {
    this._dict.Confidence = newVal;
  }
  get geometry(): Geometry<ApiCellBlock, Cell> {
    return this._geometry;
  }
  get parentTable(): Table {
    return this._parentTable;
  }
  get rowIndex(): number {
    return this._dict.RowIndex;
  }
  get rowSpan(): number {
    return this._dict.RowSpan || 1;
  }
  get text(): string {
    return this._text;
  }

  listContent(): Array<SelectionElement | Word> {
    return this._content.slice();
  }
  str(): string {
    return this._text;
  }
}

export class Row {
  _cells: Cell[];
  _parentTable: Table;

  constructor(cells: Cell[] = [], parentTable: Table) {
    this._cells = cells;
    this._parentTable = parentTable;
  }

  get nCells(): number {
    return this._cells.length;
  }
  get parentTable(): Table {
    return this._parentTable;
  }

  /**
   * Iterate through the cells in this row
   * @example
   * for (const cell of row.iterCells()) {
   *   console.log(cell.text);
   * }
   * @example
   * [...row.iterCells()].forEach(
   *   (cell) => console.log(cell.text)
   * );
   */
  iterCells(): Iterable<Cell> {
    return getIterable(() => this._cells);
  }

  listCells(): Cell[] {
    return this._cells.slice();
  }

  str(): string {
    return this._cells.map((cell) => `[${cell.str()}]`).join("");
  }
}

export class Table extends ApiBlockWrapper<ApiTableBlock> {
  _cells: Cell[];
  _geometry: Geometry<ApiTableBlock, Table>;
  _nCols: number;
  _nRows: number;
  _parentPage: Page;

  constructor(block: ApiTableBlock, parentPage: Page) {
    super(block);
    this._parentPage = parentPage;
    this._geometry = new Geometry(block.Geometry, this);

    const parentDocument = parentPage.parentDocument;
    this._cells = ([] as Cell[]).concat(
      ...(block.Relationships || [])
        .filter((rs) => rs.Type == ApiRelationshipType.Child)
        .map(
          (rs) =>
            rs.Ids.map((cid) => {
              const cellBlock = parentDocument.getBlockById(cid);
              if (!cellBlock) {
                console.warn(`Document missing child block ${cid} referenced by table cell ${this.id}`);
                return;
              }
              return new Cell(cellBlock as ApiCellBlock, this);
            }).filter((cell) => cell) as Cell[]
        )
    );

    // This indexing could be moved to a utility function if supporting more mutation operations in future:
    this._cells.sort((a, b) => a.rowIndex - b.rowIndex || a.columnIndex - b.columnIndex);
    this._nCols = this._cells.reduce((acc, next) => Math.max(acc, next.columnIndex + next.columnSpan - 1), 0);
    this._nRows = this._cells.reduce((acc, next) => Math.max(acc, next.rowIndex + next.rowSpan - 1), 0);
  }

  /**
   * Get the Cell at a particular Y, X coordinate in the table.
   * @param rowIndex 1-based index of the target row in the table
   * @param columnIndex 1-based index of the target column in the table
   * @param strict Set `true` to exclude cells rowspan/colspan cells which don't *start* at the target indices.
   * @returns Cell at the specified row & column, or undefined if none is present.
   */
  cellAt(rowIndex: number, columnIndex: number, strict = false): Cell | undefined {
    if (strict) {
      return this._cells.find((c) => c.columnIndex === columnIndex && c.rowIndex === rowIndex);
    } else {
      return this._cells.find(
        (c) =>
          c.columnIndex <= columnIndex &&
          c.columnIndex + c.columnSpan > columnIndex &&
          c.rowIndex <= rowIndex &&
          c.rowIndex + c.rowSpan > rowIndex
      );
    }
  }

  /**
   * List the cells at a particular {row, column, or combination} in the table
   * @param rowIndex 1-based index of the target row in the table
   * @param columnIndex 1-based index of the target column in the table
   * @param strict Set `true` to exclude cells rowspan/colspan cells which don't *start* at the target indices.
   * @returns Cell at the specified row & column, or undefined if none is present.
   */
  cellsAt(rowIndex: number | null, columnIndex: number | null, strict = false): Cell[] {
    return this._cells.filter(
      (c) =>
        (rowIndex == null ||
          (strict ? c.rowIndex === rowIndex : c.rowIndex <= rowIndex && c.rowIndex + c.rowSpan > rowIndex)) &&
        (columnIndex == null ||
          (strict
            ? c.columnIndex === columnIndex
            : c.columnIndex <= columnIndex && c.columnIndex + c.columnSpan > columnIndex))
    );
  }

  /**
   * Iterate through the rows of the table
   * @param repeatMultiRowCells Set `true` to include rowspan>1 cells in every `Row` they intersect with.
   * @example
   * for (const row of table.iterRows()) {
   *   for (const cell of row.iterCells()) {
   *     console.log(cell.text);
   *   }
   * }
   * @example
   * [...table.iterRows()].forEach(
   *   (row) => [...row.iterCells()].forEach(
   *     (cell) => console.log(cell.text)
   *   )
   * );
   */
  iterRows(repeatMultiRowCells = false): Iterable<Row> {
    const getIterator = (): Iterator<Row> => {
      let ixRow = 0;
      return {
        next: (): IteratorResult<Row> => {
          return ixRow < this._nRows
            ? {
                done: false,
                value: new Row(this.cellsAt(++ixRow, null, !repeatMultiRowCells), this),
              }
            : {
                done: true,
                value: undefined,
              };
        },
      };
    };
    return {
      [Symbol.iterator]: getIterator,
    };
  }

  /**
   * List the rows of the table
   * @param repeatMultiRowCells Set `true` to include rowspan>1 cells in every `Row` they intersect with.
   */
  listRows(repeatMultiRowCells = false): Row[] {
    return [...Array(this._nRows).keys()].map(
      (ixRow) => new Row(this.cellsAt(++ixRow, null, !repeatMultiRowCells), this)
    );
  }

  get confidence(): number {
    return this._dict.Confidence;
  }
  set confidence(newVal: number) {
    this._dict.Confidence = newVal;
  }
  get geometry(): Geometry<ApiTableBlock, Table> {
    return this._geometry;
  }
  get nCells(): number {
    return this._cells.length;
  }
  get nColumns(): number {
    return this._nCols;
  }
  get nRows(): number {
    return this._nRows;
  }
  get parentPage(): Page {
    return this._parentPage;
  }

  str(): string {
    return (
      "Table\n==========\n" +
      this.listRows()
        .map((row) => `Row\n==========\n${row.str()}`)
        .join("\n")
    );
  }
}

/**
 * @experimental
 */
export interface HeuristicReadingOrderModelParams {
  /**
   * Minimum ratio (0-1) of overlap to count a paragraph within a detected column. Applied relative
   * to the *minimum* of {paragraph width, column width}. Can set close to 1 if your columns are
   * well-defined with little skew and no hanging indents.
   */
  colHOverlapThresh?: number;
  /**
   * Minimum ratio (0-1) of intersection to count a paragraph within a detected column. Applied
   * relative to the *union* of {paragraph, column} horizontal span, and *only* when both the
   * paragraph and column contain multiple lines (since single-line paragraphs may be significantly
   * short). Can set close to 1 if your text is justified, since individual paragraphs in a column
   * should have reliably very similar widths.
   */
  colHMultilineUnionThresh?: number;
  /**
   * Maximum vertical distance, in multiples of line height, for a line to be considered eligible
   * for merging into a paragraph. 1.0 may make a sensible default. May set >1.0 if your text has
   * large spacing between lines within a paragraph, or <1.0 if your paragraphs have little
   * vertical separating space between them.
   */
  paraVDistTol?: number;
  /**
   * Maximum ratio of deviation of this line height from average line height in a paragraph, for a
   * line to be considered eligible for merging into a paragraph. Set close to 0 to encourage text
   * size changes to be represented as paragraph breaks (e.g. close-together heading/subheading).
   */
  paraLineHeightTol?: number;
  /**
   * Optional maximum indentation of a line versus previous, after which the line will be forced
   * into a new paragraph even if vertical distance is small. Set =0 to disable this behavior (for
   * e.g. with center-aligned text or where paragraphs are marked by vertical whitespace), or >0 to
   * specify paragraph indentation in terms of a multiplier on text line-height. Default 0.
   */
  paraIndentThresh?: number;
}

export class Page extends ApiBlockWrapper<ApiPageBlock> {
  _blocks: ApiBlock[];
  _content: Array<Line | Table | Field>;
  _form: Form;
  _geometry: Geometry<ApiPageBlock, Page>;
  _lines: Line[];
  _parentDocument: TextractDocument;
  _tables: Table[];

  constructor(pageBlock: ApiPageBlock, blocks: ApiBlock[], parentDocument: TextractDocument) {
    super(pageBlock);
    this._blocks = blocks;
    this._parentDocument = parentDocument;
    this._geometry = new Geometry(pageBlock.Geometry, this);

    // Placeholders pre-parsing to keep TypeScript happy:
    this._content = [];
    this._lines = [];
    this._tables = [];
    this._form = new Form([], this);
    // Parse the content:
    this._parse(blocks);
  }

  _parse(blocks: ApiBlock[]): void {
    this._content = [];
    this._lines = [];
    this._tables = [];
    const formKeyBlocks: ApiKeyValueSetBlock[] = [];

    blocks.forEach((item) => {
      if (item.BlockType == ApiBlockType.Line) {
        const l = new Line(item, this);
        this._lines.push(l);
        this._content.push(l);
      } else if (item.BlockType == ApiBlockType.Table) {
        const t = new Table(item, this);
        this._tables.push(t);
        this._content.push(t);
      } else if (item.BlockType == ApiBlockType.KeyValueSet) {
        if (item.EntityTypes.indexOf(ApiKeyValueEntityType.Key) >= 0) {
          formKeyBlocks.push(item);
        }
      }
    });

    this._form = new Form(formKeyBlocks, this);
  }

  /**
   * Calculate the most common orientation (in whole degrees) of 'WORD' content in the page.
   */
  getModalWordOrientationDegrees(): number | null {
    const wordDegreesByLine = this.listLines().map((line) =>
      line.listWords().map((word) => word.geometry.orientationDegrees())
    );

    const wordDegrees = ([] as Array<number | null>)
      .concat(...wordDegreesByLine)
      .filter((n) => n != null) as number[];

    return modalAvg(wordDegrees.map((n) => Math.round(n)));
  }

  /**
   * List lines in reading order, grouped by pseudo-'paragraph' and contiguous 'column'
   * @returns Nested array of text lines by column, paragraph, line
   * @private
   */
  _getLineClustersByColumn({
    colHOverlapThresh = 0.8,
    colHMultilineUnionThresh = 0.7,
    paraVDistTol = 0.7,
    paraLineHeightTol = 0.3,
    paraIndentThresh = 0,
  }: HeuristicReadingOrderModelParams = {}): Line[][][] {
    // First, assign lines to paragraphs:
    const paraBoxes: BoundingBox<ApiLineBlock, ApiObjectWrapper<ApiLineBlock>>[] = [];
    const paraLines: Line[][] = [];
    const paraTotalLineHeight: number[] = [];
    const lineHCenters = this._lines.map((l) => l.geometry.boundingBox.hCenter);
    this._lines.forEach((line, ixLine) => {
      const lineBox = line.geometry.boundingBox;
      const lineHCenter = lineHCenters[ixLine];
      // Geometries we get from Amazon Textract are bounding boxes for the detections, not necessarily
      // corrected for the inferred font size / line height. For example 'A' will be significantly taller
      // than 'a', and extreme outliers may be possible like e.g. '-'. In order to have some notion of line
      // height for grouping text to paragraphs, we'll heuristically adjust the raw boxes in special cases
      // where only a subset of small-height characters were detected:
      let isLineHeightGarbage: boolean;
      let adjLineBox: BoundingBox<unknown, ApiBlockWrapper<unknown & ApiBlock>>;
      if (!/[^.,_\s]/.test(line.text)) {
        // All low punctuation marks - line height is really a guess
        isLineHeightGarbage = true;
        adjLineBox = new BoundingBox(
          {
            Top: lineBox.top - lineBox.height * 1.5,
            Left: lineBox.left,
            Height: lineBox.height * 2.5,
            Width: lineBox.width,
          },
          null
        );
      } else if (!/[^-–—=~\s]/.test(line.text)) {
        // All low punctuation marks (e.g. just a dash?) - line height is really a guess
        isLineHeightGarbage = true;
        adjLineBox = new BoundingBox(
          {
            Top: lineBox.top - lineBox.height * 0.75, // Vertically centered on previous
            Left: lineBox.left,
            Height: lineBox.height * 2.5,
            Width: lineBox.width,
          },
          null
        );
      } else if (!/[^'"`^\s]/.test(line.text)) {
        // All high punctuation marks - line height is really a guess
        isLineHeightGarbage = true;
        adjLineBox = new BoundingBox(
          {
            Top: lineBox.top,
            Left: lineBox.left,
            Height: lineBox.height * 2.5,
            Width: lineBox.width,
          },
          null
        );
      } else if (!/[^-–—=~.,_acemnorsuvwxz+<>:;\s]/.test(line.text)) {
        // All low/mid punctuation and x-height letters - adjust line height up slightly
        isLineHeightGarbage = false;
        adjLineBox = new BoundingBox(
          {
            Top: lineBox.top - lineBox.height * 0.25,
            Left: lineBox.left,
            Height: lineBox.height * 1.25,
            Width: lineBox.width,
          },
          null
        );
      } else {
        // Keep box as-is
        isLineHeightGarbage = false;
        adjLineBox = lineBox;
      }
      let assignedPara: number | null = null;
      for (let ixPara = 0; ixPara < paraBoxes.length; ++ixPara) {
        const paraBox = paraBoxes[ixPara];
        const paraHCenter = paraBox.hCenter;
        const nCurrParaLines = paraLines[ixPara].length;
        let newTotalLineHeight: number;
        let newAvgLineHeight: number;
        if (isLineHeightGarbage) {
          newAvgLineHeight = paraTotalLineHeight[ixPara] / nCurrParaLines; // Unchanged
          newTotalLineHeight = newAvgLineHeight * (nCurrParaLines + 1);
        } else {
          newTotalLineHeight = paraTotalLineHeight[ixPara] + adjLineBox.height;
          newAvgLineHeight = newTotalLineHeight / (nCurrParaLines + 1);
        }
        // These distances can't both be >0, and will both be <0 if they overlap
        const vDist = Math.max(0, adjLineBox.top - paraBox.bottom, paraBox.top - adjLineBox.bottom);
        let passIndentationCheck: boolean;
        if (paraIndentThresh) {
          const paraLastLine = paraLines[ixPara][nCurrParaLines - 1];
          // If paragraphs are started with indentation, we should regard paragraphs with only a single line
          // in as having a reference position offset to the left. Otherwise, just paragraph bbox:
          const paraRefLeft =
            paraLastLine.geometry.boundingBox.left -
            (nCurrParaLines === 1 ? paraIndentThresh * newAvgLineHeight : 0);
          const vIsectTop = Math.max(adjLineBox.top, paraBox.top);
          const vIsectBottom = Math.min(adjLineBox.bottom, paraBox.bottom);
          const vIsect = Math.max(0, vIsectBottom - vIsectTop);
          passIndentationCheck =
            Math.max(0, adjLineBox.left - paraRefLeft) < paraIndentThresh * newAvgLineHeight ||
            vIsect > 0.5 * adjLineBox.height;
        } else {
          passIndentationCheck = true;
        }
        if (
          // Line has good horizontal overlap with the working "paragraph":
          ((lineHCenter > paraBox.left && lineHCenter < paraBox.right) ||
            (paraHCenter > lineBox.left && paraHCenter < lineBox.right)) &&
          // Line is vertically within N line-heights of the "paragraph":
          vDist < newAvgLineHeight * paraVDistTol &&
          // Line has similar line height to the rest of the "paragraph"s text, unless the line is
          // composed of such charcters that it's height is basically meaningless:
          (isLineHeightGarbage ||
            Math.abs((newAvgLineHeight - adjLineBox.height) / newAvgLineHeight) < paraLineHeightTol) &&
          // Indentation check if enabled:
          passIndentationCheck
        ) {
          assignedPara = ixPara;
          paraBoxes[ixPara] = paraBox.union(lineBox);
          paraLines[ixPara].push(line);
          paraTotalLineHeight[ixPara] = newTotalLineHeight;
          break;
        }
      }
      if (assignedPara == null) {
        paraBoxes.push(new BoundingBox(lineBox.dict));
        paraLines.push([line]);
        paraTotalLineHeight.push(lineBox.height);
      }
    });

    // At this point we essentially have paragraphs in default order, so typically columns will be
    // interleaved. Assign the paragraphs to "columns" to correct for this:
    const colBoxes: BoundingBox<ApiLineBlock, ApiObjectWrapper<ApiLineBlock>>[] = [];
    const colParas: Line[][][] = [];
    paraLines.forEach((para, ixPara) => {
      const paraBox = paraBoxes[ixPara];
      let assignedCol: number | null = null;
      for (let ixCol = 0; ixCol < colBoxes.length; ++ixCol) {
        const colBox = colBoxes[ixCol];
        const thisColParas = colParas[ixCol];
        const vIsectTop = Math.max(colBox.top, paraBox.top);
        const vIsectBottom = Math.min(colBox.bottom, paraBox.bottom);
        const vIsect = Math.max(0, vIsectBottom - vIsectTop);
        const hIsectLeft = Math.max(colBox.left, paraBox.left);
        const hIsectRight = Math.min(colBox.right, paraBox.right);
        const hIsect = Math.max(0, hIsectRight - hIsectLeft);
        const hUnion = Math.max(colBox.right, paraBox.right) - Math.min(colBox.left, paraBox.left);
        const minWidth = Math.min(colBox.width, paraBox.width);
        const proposedColBox = colBox.union(paraBox);
        const matchingVsSingleLine =
          para.length === 1 || (thisColParas.length === 1 && thisColParas[0].length === 1);
        const paraLineHeight = paraTotalLineHeight[ixPara] / paraLines[ixPara].length;
        if (
          // Paragraph has no significant vertical overlap with the working column:
          vIsect < paraLineHeight * 0.1 &&
          // Paragraph has good horizontal overlap with the working column:
          hIsect / minWidth >= colHOverlapThresh &&
          // Multi-line paragraph should have a more stringent horizontal overlap with the working
          // column (because a single-line paragraph can be short):
          (matchingVsSingleLine || hIsect / hUnion >= colHMultilineUnionThresh) &&
          hIsect / minWidth >= colHOverlapThresh &&
          // The newly-modified column would not overlap with any other column:
          colBoxes.filter((cbox) => cbox.intersection(proposedColBox)).length === 1
        ) {
          assignedCol = ixCol;
          colBoxes[ixCol] = colBox.union(paraBox);
          colParas[ixCol].push(para);
          break;
        }
      }
      if (assignedCol == null) {
        colBoxes.push(new BoundingBox(paraBox.dict));
        colParas.push([para]);
      }
    });

    return colParas;
  }

  /**
   * List lines in reading order, grouped by 'cluster' (somewhat like a paragraph)
   *
   * This method works by applying local heuristics to group text together into paragraphs, and then sorting
   * paragraphs into "columns" in reading order. Although parameters are exposed to customize the behaviour,
   * note that this customization API is experimental and subject to change. For complex requirements,
   * consider implementing your own more robust approach - perhaps using expected global page structure.
   *
   * @returns Nested array of text lines by paragraph, line
   */
  getLineClustersInReadingOrder({
    colHOverlapThresh = 0.8,
    colHMultilineUnionThresh = 0.7,
    paraVDistTol = 0.7,
    paraLineHeightTol = 0.3,
    paraIndentThresh = 0,
  }: HeuristicReadingOrderModelParams = {}): Line[][] {
    // Pass through to the private function, but flatten the result to simplify out the "columns":
    return ([] as Line[][]).concat(
      ...this._getLineClustersByColumn({
        colHOverlapThresh,
        colHMultilineUnionThresh,
        paraVDistTol,
        paraLineHeightTol,
        paraIndentThresh,
      })
    );
  }

  getTextInReadingOrder({
    colHOverlapThresh = 0.8,
    colHMultilineUnionThresh = 0.7,
    paraVDistTol = 0.7,
    paraLineHeightTol = 0.3,
    paraIndentThresh = 0,
  }: HeuristicReadingOrderModelParams = {}): string {
    return this.getLineClustersInReadingOrder({
      colHOverlapThresh,
      colHMultilineUnionThresh,
      paraVDistTol,
      paraLineHeightTol,
      paraIndentThresh,
    })
      .map((lines) => lines.map((l) => l.text).join("\n"))
      .join("\n\n");
  }

  /**
   * Iterate through the lines on the page in raw Textract order
   *
   * For reading order, see getLineClustersInReadingOrder instead.
   *
   * @example
   * for (const line of page.iterLines()) {
   *   console.log(line.text);
   * }
   */
  iterLines(): Iterable<Line> {
    return getIterable(() => this._lines);
  }

  /**
   * Iterate through the tables on the page
   * @example
   * for (const table of page.iterTables()) {
   *   console.log(table.str());
   * }
   * @example
   * const tables = [...page.iterTables()];
   */
  iterTables(): Iterable<Table> {
    return getIterable(() => this._tables);
  }

  lineAtIndex(ix: number): Line {
    if (ix < 0 || ix >= this._lines.length) {
      throw new Error(`Line index ${ix} must be >=0 and <${this._lines.length}`);
    }
    return this._lines[ix];
  }

  listBlocks(): ApiBlock[] {
    return this._blocks.slice();
  }

  listLines(): Line[] {
    return this._lines.slice();
  }

  listTables(): Table[] {
    return this._tables.slice();
  }

  tableAtIndex(ix: number): Table {
    if (ix < 0 || ix >= this._tables.length) {
      throw new Error(`Table index ${ix} must be >=0 and <${this._tables.length}`);
    }
    return this._tables[ix];
  }

  get form(): Form {
    return this._form;
  }
  get geometry(): Geometry<ApiPageBlock, Page> {
    return this._geometry;
  }
  get nLines(): number {
    return this._lines.length;
  }
  get nTables(): number {
    return this._tables.length;
  }
  get parentDocument(): TextractDocument {
    return this._parentDocument;
  }
  get text(): string {
    return this._lines.map((l) => l.text).join("\n");
  }

  str(): string {
    return `Page\n==========\n${this._content.join("\n")}\n`;
  }
}

export class TextractDocument extends ApiObjectWrapper<ApiResponsePage & ApiResponseWithContent> {
  _blockMap: { [blockId: string]: ApiBlock };
  _pages: Page[];

  /**
   * @param textractResults A (parsed) Textract response JSON, or an array of multiple from the same job
   */
  constructor(textractResults: ApiResponsePage | ApiResponsePages) {
    let dict;
    if (Array.isArray(textractResults)) {
      dict = TextractDocument._consolidateMultipleResponses(textractResults);
    } else {
      if (!("Blocks" in textractResults && textractResults.Blocks?.length)) {
        throw new Error(`Provided Textract JSON has no content! (.Blocks array)`);
      }
      dict = textractResults;
    }
    super(dict);

    if ("NextToken" in this._dict) {
      console.warn(`Provided Textract JSON contains a NextToken: Content may be truncated!`);
    }

    this._blockMap = {};
    this._pages = [];
    this._parse();
  }

  _parse(): void {
    this._blockMap = this._dict.Blocks.reduce((acc, next) => {
      acc[next.Id] = next;
      return acc;
    }, {} as { [blockId: string]: ApiBlock });

    let currentPageBlock: ApiPageBlock | null = null;
    let currentPageContent: ApiBlock[] = [];
    this._pages = [];
    this._dict.Blocks.forEach((block) => {
      if (block.BlockType == ApiBlockType.Page) {
        if (currentPageBlock) {
          this._pages.push(new Page(currentPageBlock, currentPageContent, this));
        }
        currentPageBlock = block;
        currentPageContent = [block];
      } else {
        currentPageContent.push(block);
      }
    });
    if (currentPageBlock) {
      this._pages.push(new Page(currentPageBlock, currentPageContent, this));
    }
  }

  static _consolidateMultipleResponses(
    textractResultArray: ApiResponsePages
  ): ApiResponsePage & ApiResponseWithContent {
    if (!textractResultArray?.length) throw new Error(`Input Textract Results list empty!`);
    let nPages = 0;
    const docMetadata: ApiDocumentMetadata = { Pages: 0 };
    let blocks: ApiBlock[] = [];
    let modelVersion = "";
    let analysisType: null | "AnalyzeDocument" | "DetectText" = null;
    let jobStatus: null | "IN_PROGRESS" | "SUCCEEDED" | "PARTIAL_SUCCESS" = null;
    let jobStatusMessage: null | string = null;
    let warnings: null | ApiResultWarning[] = null;
    for (const textractResult of textractResultArray) {
      if ("Blocks" in textractResult && textractResult.Blocks) {
        blocks = blocks.concat(textractResult.Blocks);
      } else {
        console.warn("Found Textract response with no content");
      }
      if ("DocumentMetadata" in textractResult) {
        Object.assign(docMetadata, textractResult["DocumentMetadata"]);
        nPages = Math.max(nPages, textractResult.DocumentMetadata.Pages);
      }
      if ("AnalyzeDocumentModelVersion" in textractResult) {
        if (analysisType && analysisType !== "AnalyzeDocument") {
          throw new Error("Inconsistent textractResults contain both AnalyzeDocument and DetectText results");
        }
        analysisType = "AnalyzeDocument";
        if (modelVersion && modelVersion !== textractResult.AnalyzeDocumentModelVersion) {
          console.warn(
            `Inconsistent Textract model versions ${modelVersion} and ${textractResult.AnalyzeDocumentModelVersion}: Ignoring latter`
          );
        } else {
          modelVersion = textractResult.AnalyzeDocumentModelVersion;
        }
      }
      if ("DetectDocumentTextModelVersion" in textractResult) {
        if (analysisType && analysisType !== "DetectText") {
          throw new Error("Inconsistent textractResults contain both AnalyzeDocument and DetectText results");
        }
        analysisType = "DetectText";
        if (modelVersion && modelVersion !== textractResult.DetectDocumentTextModelVersion) {
          console.warn(
            `Inconsistent Textract model versions ${modelVersion} and ${textractResult.DetectDocumentTextModelVersion}: Ignoring latter`
          );
        } else {
          modelVersion = textractResult.DetectDocumentTextModelVersion;
        }
      }
      if ("JobStatus" in textractResult) {
        if (
          textractResult.JobStatus == "FAILED" ||
          (textractResult.JobStatus || "").toLocaleUpperCase().indexOf("FAIL") >= 0
        ) {
          throw new Error(`Textract results contain failed job of status ${textractResult.JobStatus}`);
        } else if (jobStatus && jobStatus !== textractResult.JobStatus) {
          throw new Error(
            `Textract results inconsistent JobStatus values ${jobStatus}, ${textractResult.JobStatus}`
          );
        }
        jobStatus = textractResult.JobStatus;
      }
      if ("StatusMessage" in textractResult && textractResult.StatusMessage) {
        if (jobStatusMessage && textractResult.StatusMessage !== jobStatusMessage) {
          console.warn(`Multiple StatusMessages in Textract results - keeping longest`);
          if (textractResult.StatusMessage.length > jobStatusMessage.length) {
            jobStatusMessage = textractResult.StatusMessage;
          }
        } else {
          jobStatusMessage = textractResult.StatusMessage;
        }
      }
      if ("Warnings" in textractResult && textractResult.Warnings) {
        warnings = warnings ? warnings.concat(textractResult.Warnings) : textractResult.Warnings;
      }
    }

    const content: ApiResponseWithContent = {
      DocumentMetadata: docMetadata,
      Blocks: blocks,
    };
    const modelVersionFields =
      analysisType == "AnalyzeDocument"
        ? { AnalyzeDocumentModelVersion: modelVersion }
        : analysisType == "DetectText"
        ? { DetectDocumentTextModelVersion: modelVersion }
        : { AnalyzeDocumentModelVersion: modelVersion || "Unknown" };
    const jobStatusFields = jobStatus ? { JobStatus: jobStatus } : {};
    const statusMessageFields = jobStatusMessage ? { StatusMessage: jobStatusMessage } : {};
    const warningFields = warnings ? { ArfBarf: warnings } : {};

    return {
      ...content,
      ...modelVersionFields,
      ...jobStatusFields,
      ...statusMessageFields,
      ...warningFields,
    };
  }

  get nPages(): number {
    return this._pages.length;
  }

  getBlockById(blockId: string): ApiBlock | undefined {
    return this._blockMap && this._blockMap[blockId];
  }

  /**
   * Iterate through the pages of the document
   * @example
   * for (const page of doc.iterPages()) {
   *   console.log(page.str());
   * }
   * @example
   * const pages = [...doc.iterPages()];
   */
  iterPages(): Iterable<Page> {
    return getIterable(() => this._pages);
  }

  listBlocks(): ApiBlock[] {
    return this._dict.Blocks.slice();
  }

  listPages(): Page[] {
    return this._pages.slice();
  }

  pageNumber(pageNum: number): Page {
    if (!(pageNum >= 1 && pageNum <= this._pages.length)) {
      throw new Error(`pageNum ${pageNum} must be between 1 and ${this._pages.length}`);
    }
    return this._pages[pageNum - 1];
  }

  str(): string {
    return `\nDocument\n==========\n${this._pages.map((p) => p.str()).join("\n\n")}\n\n`;
  }
}
