import { AtomicProperty } from './atomicproperty';
import { PROPERTY_TYPE_MAPPING } from './typemapping';
import { PropertyGroup } from './formproperty';
import { ExpressionCompilerFactory } from '../expression-compiler-factory';
import { ValidatorRegistry } from './validatorregistry';
import { SchemaValidatorFactory } from '../schemavalidatorfactory';

export class StringProperty extends AtomicProperty {

  fallbackValue() {
    return '';
  }

}

PROPERTY_TYPE_MAPPING.string = (
    schemaValidatorFactory: SchemaValidatorFactory,
    validatorRegistry: ValidatorRegistry,
    expressionCompilerFactory: ExpressionCompilerFactory,
    schema: any,
    parent: PropertyGroup,
    path: string
) => {
    return new StringProperty(schemaValidatorFactory, validatorRegistry, expressionCompilerFactory, schema, parent, path);
};
