import { readFileSync } from 'fs';
import { resolve } from 'path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { GeneratePreparationDto } from './dto/generate-preparation.dto';
const workflow = JSON.parse(readFileSync(resolve(__dirname, '../../n8n/nasaq-lesson-content.json'), 'utf8'));
const code = (name: string) => workflow.nodes.find((node: any) => node.name === name).parameters.jsCode;
const build = (payload: any) => new Function('$json', '$env', code('Build prompt'))({ payload }, {})[0].json;
const shape = (data: any) => new Function('$json', code('Shape for Nasaq'))({ content: [{ type: 'text', text: JSON.stringify(data) }] })[0].json;

describe('Selected additions workflow and request validation', () => {
  it('requests only chosen additions and creates an actual exam question schema', () => {
    const result = build({ lessonTitle: 'درس', resourceTypes: ['activity', 'quiz'], exam: { questionCount: 7 } });
    const schema = result.output_config.format.schema;
    expect(Object.keys(schema.properties.resources.properties)).toEqual(['activity', 'quiz']);
    expect(schema.properties.exam.properties.questions.items.required).toContain('correctAnswer');
    expect(result.messages[0].content).toContain('7');
  });
  it('explicit [] with content disabled never asks for a homework or preparation prose', () => {
    const schema = build({ resourceTypes: [], includeContent: false }).output_config.format.schema;
    expect(Object.keys(schema.properties)).toEqual(['resources']);
    expect(schema.properties.resources.properties).toEqual({});
  });
  it('retains default homework support for an older backend workflow request', () => {
    expect(build({}).output_config.format.schema.properties.resources.required).toEqual(['homework']);
  });
  it('keeps correct answers in the exam payload, outside student-facing resource descriptions', () => {
    const result = shape({ resources: { quiz: { title: 'امتحان الدرس', description: 'أجب عن الأسئلة' } },
      exam: { questions: [{ question: '١+١؟', options: ['١', '٢'], correctAnswer: '٢' }] } });
    expect(result.resources).toEqual([{ type: 'quiz', title: 'امتحان الدرس', description: 'أجب عن الأسئلة' }]);
    expect(result.exam.questions[0].correctAnswer).toBe('٢');
  });
  it('fails on refusal or incomplete generation rather than returning an apparent success', () => {
    for (const stop_reason of ['refusal', 'max_tokens']) expect(() => new Function('$json', code('Shape for Nasaq'))({ stop_reason })).toThrow();
  });
  it('validates resource names, duplicates, booleans and nested exam fields', async () => {
    for (const data of [{ resourceTypes: ['unknown'] }, { resourceTypes: ['activity', 'activity'] },
      { resourceTypes: 'homework' }, { includeContent: 'false' }, { resourceTypes: ['quiz'], exam: { duration: 0, questionCount: 21 } },
      { resourceTypes: ['quiz'], exam: { examType: 'quiz', startDate: '2026-02-30', endDate: '2026-03-01', duration: 30, questionCount: 5 } }]) {
      expect((await validate(plainToInstance(GeneratePreparationDto, data))).length).toBeGreaterThan(0);
    }
    expect(await validate(plainToInstance(GeneratePreparationDto, { resourceTypes: [], includeContent: false }))).toEqual([]);
  });
});
