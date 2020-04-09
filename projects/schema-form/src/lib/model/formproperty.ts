import {BehaviorSubject, combineLatest} from 'rxjs';
import {distinctUntilChanged, map} from 'rxjs/operators';

import {SchemaValidatorFactory} from '../schemavalidatorfactory';
import {ValidatorRegistry} from './validatorregistry';
import {PropertyBindingRegistry} from '../property-binding-registry';
import { ExpressionCompilerFactory, ExpressionCompilerVisibilityIf } from '../expression-compiler-factory';

export abstract class FormProperty {
  public schemaValidator: Function;
  public expressionCompilerVisibiltyIf: ExpressionCompilerVisibilityIf;

  _value: any = null;
  _errors: any = null;
  private _valueChanges = new BehaviorSubject<any>(null);
  private _errorsChanges = new BehaviorSubject<any>(null);
  private _visible = true;
  private _visibilityChanges = new BehaviorSubject<boolean>(true);
  private _root: PropertyGroup;
  private _parent: PropertyGroup;
  private _path: string;
  _propertyBindingRegistry: PropertyBindingRegistry;
  __canonicalPath: string;
  __canonicalPathNotation: string;

  /**
   * Provides the unique path of this form element.<br/>
   * E.g.:
   * <code>/garage/cars</code>,<br/>
   * <code>/shop/book/0/page/1/</code>
   */
  get _canonicalPath() { return this.__canonicalPath; }
  set _canonicalPath(canonicalPath: string) {
    this.__canonicalPath = canonicalPath;
    this.__canonicalPathNotation = (this.__canonicalPath||'')
      .replace(new RegExp('^/', 'ig'), '')
      .replace(new RegExp('/$', 'ig'), '')
      .replace(new RegExp('/', 'ig'), '.');
  }
  /**
   * Uses the unique path provided by the property <code>_canonicalPath</code><br/>
   * but converts it to a HTML Element Attribute ID compliant format.<br/>
   * E.g.:
   * <code>garage.cars</code>,<br/>
   * <code>shop.book.0.page.1.</code>
   */
  get canonicalPathNotation() { return this.__canonicalPathNotation; }

  private _rootName;
  /**
   * Provides the HTML Element Attribute ID/NAME compliant representation
   * of the root element.<br/>
   * Represents the HTML FORM NAME.<br/>
   * Only the root <code>FormProperty</code> will provide a value here.
   */
  get rootName() { return this._rootName; }

  constructor(schemaValidatorFactory: SchemaValidatorFactory,
              private validatorRegistry: ValidatorRegistry,
              expressionCompilerFactory: ExpressionCompilerFactory,
              public schema: any,
              parent: PropertyGroup,
              path: string) {
    this.schemaValidator = schemaValidatorFactory.createValidatorFn(this.schema);
    this.expressionCompilerVisibiltyIf = expressionCompilerFactory.createExpressionCompilerVisibilityIf();

    this._parent = parent;
    if (parent) {
      this._root = parent.root;
    } else if (this instanceof PropertyGroup) {
      this._root = <PropertyGroup><any>this;
      this._rootName = this.createRootName();
    }
    this._path = path;
    // calculate canonical path
    /**
     * To assert that the canonical path is already computed for a container widget (object, array)
     * before any children are appended it must be done here.
     */
    this._canonicalPath = this.calculateCanonicalPath(path, parent)
    /** TODO remove logs*/ console.log('#### Create widget type:', ((this.schema.widget || { id: '' }).id || this.schema.widget), ['path:', `${this._canonicalPath}`], this, 'root:', this.root)
  }

  private calculateCanonicalPath(propertyPath: string, parent: PropertyGroup): string {
    let _canonicalPath = '';
    if (parent) {
      _canonicalPath += parent._canonicalPath
      if (parent.parent !== null) {
        _canonicalPath += '/';
      }
      if (parent instanceof PropertyGroup) {
        if (parent.type === 'object') {/** Keep in mind that an array item may be represented as an object */
          _canonicalPath += propertyPath.split('/').slice(-1)[0];
        } else if (parent.type === 'array') {
          _canonicalPath += `${parent.properties.length}`;
        } else {
          throw 'Instanciation of a FormProperty with an unknown parent type: ' + parent.type;
        }
      }
    } else {
      _canonicalPath = '/';
    }
    return _canonicalPath;
  }

  /**
   * Creates the HTML ID and NAME attribute compliant string.
   */
  private createRootName(): string {
    if (this.schema && this.schema['name']) {
      return this._rootName = this.schema['name'].replace(new RegExp('[\\s]+', 'ig'), '_')
    }
    return ''
  }

  public get valueChanges() {
    return this._valueChanges;
  }

  public get errorsChanges() {
    return this._errorsChanges;
  }

  public get type(): string {
    return this.schema.type;
  }

  public get parent(): PropertyGroup {
    return this._parent;
  }

  public get root(): PropertyGroup {
    return this._root || <PropertyGroup><any>this;
  }

  public get path(): string {
    return this._path;
  }

  public get value() {
    return this._value;
  }

  public get visible() {
    return this._visible;
  }

  public get valid() {
    return this._errors === null;
  }

  public abstract setValue(value: any, onlySelf: boolean);

  public abstract reset(value: any, onlySelf: boolean);

  public updateValueAndValidity(onlySelf = false, emitEvent = true) {
    this._updateValue();

    if (emitEvent) {
      this.valueChanges.next(this.value);
    }

    this._runValidation();

    if (this.parent && !onlySelf) {
      this.parent.updateValueAndValidity(onlySelf, emitEvent);
    }

  }

  /**
   * @internal
   */
  public abstract _hasValue(): boolean;

  /**
   *  @internal
   */
  public abstract _updateValue();

  /**
   * @internal
   */
  public _runValidation(): any {
    let errors = this.schemaValidator(this._value) || [];
    let customValidator = this.validatorRegistry.get(this.path);
    if (customValidator) {
      let customErrors = customValidator(this.value, this, this.findRoot());
      errors = this.mergeErrors(errors, customErrors);
    }
    if (errors.length === 0) {
      errors = null;
    }

    this._errors = errors;
    this.setErrors(this._errors);
  }

  private mergeErrors(errors, newErrors) {
    if (newErrors) {
      if (Array.isArray(newErrors)) {
        errors = errors.concat(...newErrors);
      } else {
        errors.push(newErrors);
      }
    }
    return errors;
  }

  private setErrors(errors) {
    this._errors = errors;
    this._errorsChanges.next(errors);
  }

  public extendErrors(errors) {
    errors = this.mergeErrors(this._errors || [], errors);
    this.setErrors(errors);
  }

  searchProperty(path: string): FormProperty {
    let prop: FormProperty = this;
    let base: PropertyGroup = null;

    let result = null;
    if (path[0] === '/') {
      base = this.findRoot();
      result = base.getProperty(path.substr(1));
    } else {
      while (result === null && prop.parent !== null) {
        prop = base = prop.parent;
        result = base.getProperty(path);
      }
    }
    return result;
  }

  public findRoot(): PropertyGroup {
    let property: FormProperty = this;
    while (property.parent !== null) {
      property = property.parent;
    }
    return <PropertyGroup>property;
  }

  private setVisible(visible: boolean) {
    this._visible = visible;
    this._visibilityChanges.next(visible);
    this.updateValueAndValidity();
    if (this.parent) {
      this.parent.updateValueAndValidity(false, true);
    }
  }

  /**
   * Making use of the expression compiler for the <code>visibleIf</code> condition
   */
  private __evaluateVisibilityIf(
    sourceProperty: FormProperty,
    targetProperty: FormProperty,
    dependencyPath: string,
    value: any = '',
    expression: string|string[]|number = ''): boolean {
    try {
      let valid = false
      if (isNaN(expression as number) && (expression as string).indexOf('$ANY$') !== -1) {
        valid = value && value.length > 0;
      } else if ((expression||[]).toString().indexOf('$EXP$') === 0) {
        // since visibleIf condition values are an array... we must do this
        const expArray = Array.isArray(expression) ? expression : (expression ? [expression] : [])
        for (const expString of expArray) {
          const _expresssion = (expString as string).substring('$EXP$'.length);
          valid = true === this.expressionCompilerVisibiltyIf.evaluate(_expresssion, {
            source: sourceProperty,
            target: targetProperty
          })
          if (valid) {
            break
          }
        }
      } else {
        valid = isNaN(value) ? value.indexOf(expression) !== -1 : value === expression;
      }
      return valid
    } catch (error) {
      console.error('Error processing "VisibileIf" expression for path: ', dependencyPath,
        `source - ${sourceProperty._canonicalPath}: `, sourceProperty,
        `target - ${targetProperty._canonicalPath}: `, targetProperty,
        'value:', value,
        'expression: ', expression,
        'error: ', error)
    }
  }

  private __bindVisibility(): boolean {
    /**
     * <pre>
     *     "oneOf":[{
     *         "path":["value","value"]
     *     },{
     *         "path":["value","value"]
     *     }]
     *     </pre>
     * <pre>
     *     "allOf":[{
     *         "path":["value","value"]
     *     },{
     *         "path":["value","value"]
     *     }]
     *     </pre>
     */
    const visibleIfProperty = this.schema.visibleIf;
    const visibleIfOf = (visibleIfProperty || {}).oneOf || (visibleIfProperty || {}).allOf;
    if (visibleIfOf) {
      for (const visibleIf of visibleIfOf) {
        if (typeof visibleIf === 'object' && Object.keys(visibleIf).length === 0) {
          this.setVisible(false);
        } else if (visibleIf !== undefined) {
          const propertiesBinding = [];
          for (const dependencyPath in visibleIf) {
            if (visibleIf.hasOwnProperty(dependencyPath)) {
              const properties = this.findProperties(this, dependencyPath);
              if ((properties || []).length) {
                for (const property of properties) {
                  if (property) {
                    let valueCheck;
                    if (this.schema.visibleIf.oneOf) {
                      valueCheck = property.valueChanges.pipe(map(
                        value => this.__evaluateVisibilityIf(this, property, dependencyPath, value, visibleIf[dependencyPath])
                      ));
                    } else if (this.schema.visibleIf.allOf) {
                      const _chk = (value) => {
                        for (const item of this.schema.visibleIf.allOf) {
                          for (const depPath of Object.keys(item)) {
                            const prop = this.searchProperty(depPath);
                            const propVal = prop.value;
                            if (!this.__evaluateVisibilityIf(this, prop, dependencyPath, propVal, item[depPath])) {
                              return false;
                            }
                          }
                        }
                        return true;
                      };
                      valueCheck = property.valueChanges.pipe(map(_chk));
                    }
                    const visibilityCheck = property._visibilityChanges;
                    const and = combineLatest([valueCheck, visibilityCheck], (v1, v2) => v1 && v2);
                    propertiesBinding.push(and);
                  }
                }
              } else {
                console.warn('Can\'t find property ' + dependencyPath + ' for visibility check of ' + this.path + ' (' + this._canonicalPath + ')', this);
                this.registerMissingVisibilityBinding(dependencyPath, this);
                // not visible if not existent
                this.setVisible(false);
              }
            }
          }

          combineLatest(propertiesBinding, (...values: boolean[]) => {
            return values.indexOf(true) !== -1;
          }).pipe(distinctUntilChanged()).subscribe((visible) => {
            this.setVisible(visible);
          });
        }
      }
      return true;
    }
  }

  // A field is visible if AT LEAST ONE of the properties it depends on is visible AND has a value in the list
  public _bindVisibility() {
    if (this.__bindVisibility())
      return;
    let visibleIf = this.schema.visibleIf;
    if (typeof visibleIf === 'object' && Object.keys(visibleIf).length === 0) {
      this.setVisible(false);
    } else if (visibleIf !== undefined) {
      let propertiesBinding = [];
      for (let dependencyPath in visibleIf) {
        if (visibleIf.hasOwnProperty(dependencyPath)) {
          const properties = this.findProperties(this, dependencyPath);
          if ((properties || []).length) {
            for (const property of properties) {
              if (property) {
                const valueCheck = property.valueChanges.pipe(map(
                  value => this.__evaluateVisibilityIf(this, property, dependencyPath, value, visibleIf[dependencyPath])
                ));
                const visibilityCheck = property._visibilityChanges;
                const and = combineLatest([valueCheck, visibilityCheck], (v1, v2) => v1 && v2);
                propertiesBinding.push(and);
              }
            }
          } else {
            console.warn('Can\'t find property ' + dependencyPath + ' for visibility check of ' + this.path + ' (' + this._canonicalPath + ')', this);
            this.registerMissingVisibilityBinding(dependencyPath, this);
            // not visible if not existent
            this.setVisible(false);
          }
        }
      }

      combineLatest(propertiesBinding, (...values: boolean[]) => {
        return values.indexOf(true) !== -1;
      }).pipe(distinctUntilChanged()).subscribe((visible) => {
        this.setVisible(visible);
      });
    }
  }

  private registerMissingVisibilityBinding(dependencyPath: string, formProperty: FormProperty) {
    formProperty._propertyBindingRegistry.getPropertyBindingsVisibility().add(dependencyPath, formProperty.path);
  }


  /**
   * Finds all <code>formProperties</code> from a path with wildcards.<br/>
   * e.g: <code>/garage/cars/&#42;/tires/&#42;/name</code><br/>
   * @param target
   * @param propertyPath
   */
  findProperties(target: FormProperty, propertyPath: string): FormProperty[] {
    const props: FormProperty[] = [];
    const paths = this.findPropertyPaths(target, propertyPath);
    for (const path of paths) {
      const p: FormProperty = target.searchProperty(path);
      if (p) {
        props.push(p);
      }
    }
    return props;
  }

  /**
   * Creates canonical paths from a path with wildcards.
   * e.g:<br/>
   * From:<br/>
   * <code>/garage/cars/&#42;/tires/&#42;/name</code><br/>
   * it creates:<br/>
   * <code>/garage/cars/0/tires/0/name</code><br/>
   * <code>/garage/cars/0/tires/1/name</code><br/>
   * <code>/garage/cars/0/tires/2/name</code><br/>
   * <code>/garage/cars/0/tires/3/name</code><br/>
   * <code>/garage/cars/1/tires/0/name</code><br/>
   * <code>/garage/cars/2/tires/1/name</code><br/>
   * <code>/garage/cars/3/tires/2/name</code><br/>
   * <code>/garage/cars/3/tires/3/name</code><br/>
   * <code>/garage/cars/&#42;/tires/&#42;/name</code><br/>
   * <code>/garage/cars/&#42;/tires/2/name</code><br/>
   * <code>/garage/cars/&#42;/tires/3/name</code><br/>
   * <br/>etc...
   * @param target
   * @param path
   * @param parentPath
   */
  findPropertyPaths(target: FormProperty, path: string, parentPath?: string): string[] {
    const ix = path.indexOf('*');
    if (-1 !== ix) {
      const prePath = ix > -1 ? path.substring(0, ix - 1) : path;
      const subPath = ix > -1 ? path.substring(ix + 1) : path;
      const prop: FormProperty = target.searchProperty(prePath);
      let pathFound = [];
      if (prop instanceof PropertyGroup) {
        const arrProp = prop.properties as FormProperty[];
        for (let i = 0; i < arrProp.length; i++) {
          const curreItemPath = (parentPath || '') + prePath + (prePath.endsWith('/') ? '' : '/') + i + subPath;
          const curreItemPrePath = (parentPath || '') + prePath + i;
          if (-1 === curreItemPath.indexOf('*')) {
            pathFound.push(curreItemPath);
          }
          const childrenPathFound = this.findPropertyPaths(arrProp[i], subPath, curreItemPrePath);
          pathFound = pathFound.concat(childrenPathFound);
        }
      }
      return pathFound;
    }
    return [path];
  }
}
export class PropertyGroupProxyHandler implements ProxyHandler<FormProperty[] | { [key: string]: FormProperty }>  {
  constructor(private propertyGroup:PropertyGroup){}
  /**
   * When a new item is added it will be checked for visibility updates to proceed <br/>
   * if any other field has a binding reference to it.<br/>
   */
  set(target: FormProperty[] | { [p: string]: FormProperty }, p: PropertyKey, value: any, receiver: any): boolean {
/** TODO remove logs*/ console.log('**** addProperty', (value as FormProperty)._canonicalPath,target ,p ,value, 'root:', (value as FormProperty).root)
    /**
     * 1) Make sure a canonical path is set
     */
    const assertCanonicalPath = (propertyValue: any) => {
      const formProperty = propertyValue as FormProperty;
      if (Array.isArray(target) && propertyValue instanceof FormProperty) {
        /**
         * Create a canonical path replacing the last '*' with the elements position in array
         * @param propertyPath
         * @param indexOfChild
         */
        const getCanonicalPath = (propertyPath: string, indexOfChild: number) => {
          let pos;
          if (propertyPath && -1 !== (pos = propertyPath.lastIndexOf('*'))) {
            return propertyPath.substring(0, pos) + indexOfChild.toString() + propertyPath.substring(pos + 1);
          }
          return propertyPath
        };
        if (formProperty) {
          formProperty._canonicalPath = getCanonicalPath(formProperty._canonicalPath, p as number);
        }
      }

      const propertyGroup = formProperty as PropertyGroup;
      const propertyGroupChildren = [].concat((Array.isArray(propertyGroup.properties) ?
        propertyGroup.properties :
        Object.values(propertyGroup.properties || {})) as FormProperty[]);
      if ((formProperty.path || '').endsWith('/*')) {
        /**
         * If it is an array, then all children canonical paths must be computed now.
         * The children don't have the parent's path segment set yet,
         * because they are created before the parent gets attached to its children.
         */
        for (const child of propertyGroupChildren) {
          child._canonicalPath = formProperty._canonicalPath + child._canonicalPath.substring(formProperty.path.length);
        }
      }
      return {property: formProperty, children: propertyGroupChildren};
    };
    const {property, children} = assertCanonicalPath(value);

    /**
     * 2) Add the new property before rebinding, so it can be found by <code>_bindVisibility</code>
     */
    const result = target[p as string] = value;

    /**
     * 3) Re-bind the visibility bindings referencing to this canonical paths
     */
    const rebindVisibility = () => {
      const rebindAll = [property].concat(children);
      const findPropertiesToRebind = (formProperty: FormProperty) => {
        const propertyBindings = formProperty._propertyBindingRegistry.getPropertyBindingsVisibility();
        const appendPropertiesToRebind = (propCanonicalPath:string, bindingPaths: string[]): string[] => {
          bindingPaths = bindingPaths.concat(propertyBindings.findByDependencyPath(propCanonicalPath) || []);
          /** reverse bindings search if the target doesn't yet exist */
          const _bindingPaths = bindingPaths.concat(propertyBindings.getBySourcePropertyPath(propCanonicalPath) || [])

          return bindingPaths.concat(_bindingPaths);
        }
        let rebind: string[] = [];
        if (formProperty._canonicalPath) {
          rebind = appendPropertiesToRebind(formProperty._canonicalPath, rebind)
          if (formProperty._canonicalPath.startsWith('/')) {
            rebind = appendPropertiesToRebind(formProperty._canonicalPath.substring(1), rebind)
          }
        }
        rebind = appendPropertiesToRebind(formProperty.path, rebind)
        if (formProperty.path.startsWith('/')) {
          rebind = appendPropertiesToRebind(formProperty.path.substring(1), rebind)
        }
        const uniqueValues = {};
        for (const item of rebind) {
          if (-1 !== item.indexOf('*')) {
            /**
             * Array paths must be resolved pointing to all available items
             */
            const resolvedArrayItemPaths = this.propertyGroup.findPropertyPaths(this.propertyGroup, item, item.startsWith('/') ? '' : this.propertyGroup.path)
            if (resolvedArrayItemPaths) {
              for (const rp of resolvedArrayItemPaths) {
                uniqueValues[rp] = rp
              }
            }
          } else {
            uniqueValues[item] = item;
          }
        }
        return Object.keys(uniqueValues);
      };
      const rebound=[]
      for (const _property of rebindAll) {
        if (_property instanceof FormProperty) {
          try {
            const rebindPaths = findPropertiesToRebind(_property);
            for (const rebindPropPath of rebindPaths) {
              const rebindProp = _property.searchProperty(rebindPropPath);
              if (rebindProp) {
                rebindProp._bindVisibility();
                rebound.push(rebindProp._canonicalPath);
              } else {
                /** when ${rebindPropPath} doesn't yet exist  */
              }
            }
          } catch (e) {
            console.error('Rebinding visibility error at path:', _property.path, 'property:', _property, e);
          }
        }
      }
      return rebound;
    };
    const rebound = rebindVisibility();
    /** TODO remove logs*/ if((rebound||[]).length)
    /** TODO remove logs*/ console.log('REBOUND: from', `${this.propertyGroup._canonicalPath} from (${this.propertyGroup.path})`, 'rebound-properties:', rebound, 'group:', this.propertyGroup, 'group-children-keys:',Object.keys(this.propertyGroup.properties),'root:', this.propertyGroup.root)

    return result;
  }
  get(target: FormProperty[] | { [p: string]: FormProperty }, p: PropertyKey, receiver: any): any {
    return target[p as string];
  }
  deleteProperty(target: FormProperty[] | { [p: string]: FormProperty }, p: PropertyKey): boolean {
    return delete target[p as string];
  }
};
export abstract class PropertyGroup extends FormProperty {

  _properties: FormProperty[] | { [key: string]: FormProperty } = null;

  get properties() {
    return this._properties;
  }

  set properties(properties: FormProperty[] | { [key: string]: FormProperty }) {
    /**
     * Override the setter to add an observer that notices when an item is added or removed.<br/>
     */
    this._properties = new Proxy(properties, this._propertyProxyHandler);
  }

  private _propertyProxyHandler: ProxyHandler<FormProperty[] | { [key: string]: FormProperty }> = new PropertyGroupProxyHandler(this)

  getProperty(path: string) {
    let subPathIdx = path.indexOf('/');
    let propertyId = subPathIdx !== -1 ? path.substr(0, subPathIdx) : path;

    let property = this.properties[propertyId];
    if (property !== null && subPathIdx !== -1 && property instanceof PropertyGroup) {
      let subPath = path.substr(subPathIdx + 1);
      property = (<PropertyGroup>property).getProperty(subPath);
    }
    return property;
  }

  public forEachChild(fn: (formProperty: FormProperty, str: String) => void) {
    for (let propertyId in this.properties) {
      if (this.properties.hasOwnProperty(propertyId)) {
        let property = this.properties[propertyId];
        fn(property, propertyId);
      }
    }
  }

  public forEachChildRecursive(fn: (formProperty: FormProperty) => void) {
    this.forEachChild((child) => {
      fn(child);
      if (child instanceof PropertyGroup) {
        (<PropertyGroup>child).forEachChildRecursive(fn);
      }
    });
  }

  public _bindVisibility() {
    super._bindVisibility();
    this._bindVisibilityRecursive();
  }

  private _bindVisibilityRecursive() {
    this.forEachChildRecursive((property) => {
      property._bindVisibility();
    });
  }

  public isRoot() {
    return this === this.root;
  }
}


